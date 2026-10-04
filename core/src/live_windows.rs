//! Owner-only, local named pipes with bounded nonblocking I/O. Business state stays in live.
use interprocess::os::windows::{
    named_pipe::{DuplexPipeStream, PipeListener, PipeListenerOptions, pipe_mode::Bytes},
    security_descriptor::SecurityDescriptor,
};
use std::os::windows::io::AsRawHandle;
use std::{
    cell::Cell,
    io::{self, Read, Write},
    path::Path,
    time::{Duration, Instant},
};
use widestring::u16cstr;
use windows_sys::Win32::{Foundation::ERROR_BROKEN_PIPE, System::Pipes::PeekNamedPipe};

fn trace(message: impl AsRef<str>) {
    if std::env::var_os("WOMBAT_SERVICE_TRACE").as_deref() == Some(std::ffi::OsStr::new("1")) {
        eprintln!("[wombat-service] {}", message.as_ref());
    }
}

pub struct Listener(PipeListener<Bytes, Bytes>);
pub struct Stream {
    pipe: DuplexPipeStream<Bytes>,
    read_deadline: Cell<Instant>,
    write_deadline: Cell<Instant>,
    sent: bool,
}
impl Listener {
    pub fn bind(path: &Path) -> io::Result<Self> {
        // Protected DACL: only the creator/owner. Remote pipe clients are also rejected.
        let sd = SecurityDescriptor::deserialize(u16cstr!("D:P(A;;GA;;;OW)"))?;
        let listener = PipeListenerOptions::new()
            .path(path.as_os_str())
            .accept_remote(false)
            .nonblocking(true)
            .security_descriptor(Some(sd))
            .create_duplex::<Bytes>()?;
        trace("listener bound");
        Ok(Self(listener))
    }
    pub fn set_nonblocking(&self, value: bool) -> io::Result<()> {
        self.0.set_nonblocking(value)
    }
    pub fn accept(&self) -> io::Result<(Stream, ())> {
        let pipe = self.0.accept()?;
        trace("client accepted");
        pipe.set_nonblocking(true)?;
        let deadline = Instant::now() + Duration::from_secs(12);
        Ok((
            Stream {
                pipe,
                read_deadline: Cell::new(deadline),
                write_deadline: Cell::new(deadline),
                sent: false,
            },
            (),
        ))
    }
}
fn bounded<T>(deadline: Instant, mut operation: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    loop {
        if Instant::now() >= deadline {
            return Err(io::ErrorKind::TimedOut.into());
        }
        match operation() {
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                ) =>
            {
                std::thread::sleep(Duration::from_millis(5))
            }
            result => return result,
        }
    }
}
impl Stream {
    // Keep the OS pipe nonblocking; bounded() provides the synchronous service interface.
    pub fn set_nonblocking(&self, _value: bool) -> io::Result<()> {
        self.pipe.set_nonblocking(true)
    }
    pub fn set_read_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
        self.read_deadline
            .set(Instant::now() + timeout.unwrap_or(Duration::from_secs(12)));
        Ok(())
    }
    pub fn set_write_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
        self.write_deadline
            .set(Instant::now() + timeout.unwrap_or(Duration::from_secs(12)));
        Ok(())
    }
}
impl Read for &Stream {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        bounded(self.read_deadline.get(), || {
            let mut available = 0;
            // Peek avoids treating PIPE_NOWAIT's ERROR_NO_DATA as EOF. The handle remains
            // owned by the pipe, and the sole out-pointer lives throughout this call.
            let ok = unsafe {
                PeekNamedPipe(
                    self.pipe.as_raw_handle(),
                    std::ptr::null_mut(),
                    0,
                    std::ptr::null_mut(),
                    &mut available,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 {
                let error = io::Error::last_os_error();
                return if error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) {
                    Ok(0)
                } else {
                    Err(error)
                };
            }
            if available == 0 {
                return Err(io::ErrorKind::WouldBlock.into());
            }
            trace(format!("reading {available} available byte(s)"));
            let result = (&self.pipe).read(output);
            trace(format!("read result: {result:?}"));
            result
        })
    }
}
impl Write for Stream {
    fn write(&mut self, input: &[u8]) -> io::Result<usize> {
        trace(format!("writing {} byte(s)", input.len()));
        let count = bounded(self.write_deadline.get(), || {
            match (&self.pipe).write(input) {
                Ok(0) if !input.is_empty() => Err(io::ErrorKind::WouldBlock.into()),
                result => result,
            }
        })?;
        trace(format!("wrote {count} byte(s)"));
        self.sent |= count > 0;
        Ok(count)
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        if self.sent {
            // The client closes after receiving the newline-delimited response. Wait for
            // that acknowledgement with the same write deadline, then close even if the
            // client stalls; interprocess's unbounded background flush is not used.
            self.read_deadline.set(self.write_deadline.get());
            let acknowledgement = bounded(self.write_deadline.get(), || {
                match (&*self).read(&mut [0; 1]) {
                    Ok(0) => Ok(()),
                    Ok(_) => Err(io::ErrorKind::WouldBlock.into()),
                    Err(error) => Err(error),
                }
            });
            trace(format!("client close acknowledgement: {acknowledgement:?}"));
        }
        self.pipe.assume_flushed();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stalled_io_has_a_deadline() {
        let result: io::Result<()> = bounded(Instant::now() + Duration::from_millis(10), || {
            Err(io::ErrorKind::WouldBlock.into())
        });
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn owner_can_exchange_large_response_and_idle_reads_expire() {
        let name = format!(r"\\.\pipe\wombat-test-{}", uuid::Uuid::new_v4());
        let listener = Listener::bind(Path::new(&name)).unwrap();
        assert!(
            Listener::bind(Path::new(&name)).is_err(),
            "first instance is exclusive"
        );
        let (idle_tx, idle_rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let (mut stream, ()) = bounded(Instant::now() + Duration::from_secs(5), || {
                listener.accept()
            })
            .unwrap();
            stream
                .set_read_timeout(Some(Duration::from_millis(30)))
                .unwrap();
            assert_eq!(
                (&stream).read(&mut [0; 1]).unwrap_err().kind(),
                io::ErrorKind::TimedOut
            );
            idle_tx.send(()).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = [0; 4];
            (&stream).read_exact(&mut request).unwrap();
            assert_eq!(&request, b"ping");
            stream.write_all(&vec![b'x'; 65536]).unwrap();
        });
        let mut client = DuplexPipeStream::<Bytes>::connect_by_path(name.as_str()).unwrap();
        idle_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        client.write_all(b"ping").unwrap();
        let mut response = vec![0; 65536];
        client.read_exact(&mut response).unwrap();
        assert!(response.iter().all(|byte| *byte == b'x'));
        drop(client);
        worker.join().unwrap();
    }

    #[test]
    fn closing_a_stalled_client_has_a_deadline() {
        let name = format!(r"\\.\pipe\wombat-test-{}", uuid::Uuid::new_v4());
        let listener = Listener::bind(Path::new(&name)).unwrap();
        let client = DuplexPipeStream::<Bytes>::connect_by_path(name.as_str()).unwrap();
        let (mut stream, ()) = listener.accept().unwrap();
        stream
            .set_write_timeout(Some(Duration::from_millis(30)))
            .unwrap();
        stream.write_all(b"response\n").unwrap();
        let start = Instant::now();
        drop(stream);
        assert!(start.elapsed() < Duration::from_secs(1));
        drop(client);
    }

    #[test]
    fn response_survives_until_the_client_reads_it() {
        let name = format!(r"\\.\pipe\wombat-test-{}", uuid::Uuid::new_v4());
        let listener = Listener::bind(Path::new(&name)).unwrap();
        let mut client = DuplexPipeStream::<Bytes>::connect_by_path(name.as_str()).unwrap();
        let worker = std::thread::spawn(move || {
            let (mut stream, ()) = listener.accept().unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            stream.write_all(b"response\n").unwrap();
        });
        std::thread::sleep(Duration::from_millis(50));
        let mut response = [0; 9];
        client.read_exact(&mut response).unwrap();
        assert_eq!(&response, b"response\n");
        drop(client);
        worker.join().unwrap();
    }
}
