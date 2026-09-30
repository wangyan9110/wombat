"""Fixed synthetic live-index benchmark. Run after pnpm build; POSIX/macOS only.

python3 scripts/benchmark-live.py --output /tmp/wombat-live-benchmark.json
--core selects an earlier release binary for an identical-corpus comparison.
Never reads user logs. All inputs, index files and captured replies are isolated.
"""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, tempfile, time
from decimal import Decimal

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--core', type=pathlib.Path, default=pathlib.Path('dist/wombat-core'))
parser.add_argument('--measurements', type=int, default=100000)
parser.add_argument('--threads', type=int, default=500)
parser.add_argument('--appends', type=int, default=12)
parser.add_argument('--output', type=pathlib.Path, required=True)
args = parser.parse_args()
assert args.measurements > 0 and 0 < args.threads <= args.measurements and args.appends > 0
repo = pathlib.Path(__file__).resolve().parents[1]
core = args.core.resolve()
root = pathlib.Path(tempfile.mkdtemp(prefix='wombat-memory-bench-'))
source = root/'source'
(source/'sessions').mkdir(parents=True)
env = dict(os.environ, WOMBAT_DATA_HOME=str(root/'data'), CODEX_HOME=str(source), WOMBAT_CORE_BIN=str(core))

def record(thread, response):
    return {'type':'event_msg','timestamp':'2026-09-29T00:00:01Z','payload':{'type':'token_usage_record','thread_id':thread,'turn_id':'u','response_id':str(response),'usage':{'input_tokens':100,'cached_input_tokens':60,'cache_write_input_tokens':0,'output_tokens':10,'reasoning_output_tokens':2,'total_tokens':110}}}

def line(value):
    return json.dumps(value,separators=(',',':'))+'\n'

raw = hashlib.sha256()
for i in range(args.threads):
    thread = 'thread-'+str(i)
    with (source/'sessions'/f'{i}.jsonl').open('w') as f:
        rows = [ {'type':'session_meta','payload':{'id':thread}}, {'type':'turn_context','payload':{'turn_id':'u','model':'gpt-5.4','effort':'high'}} ]
        for value in rows:
            text=line(value);f.write(text);raw.update(text.encode())
        for j in range(i,args.measurements,args.threads):
            for value in [record(thread,j), {'type':'response_item','payload':{'type':'function_call','name':'read_file','call_id':str(j),'arguments':'SYNTHETIC_PRIVATE_ARGUMENT'}}]:
                text=line(value);f.write(text);raw.update(text.encode())

service = subprocess.Popen([str(core),'--serve-usage'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)

def query(action='usage'):
    start=time.perf_counter()
    command=['node',str(repo/'dist/wombat.js'),action,'--fresh','--since','2026-09-29','--until','2026-09-30','--json']
    p=subprocess.run(command,env=env,capture_output=True,text=True,timeout=15)
    v=json.loads(p.stdout)
    if v.get('error',{}).get('code') == 'SYNC_TIMEOUT': return None
    assert p.returncode == 0,(p.returncode,v.get('error'))
    assert v['freshness']['status']=='current'
    return (time.perf_counter()-start)*1000,v

try:
    start=time.perf_counter();deadline=start+120
    while True:
        first=query()
        if first is not None:break
        assert time.perf_counter()<deadline,'cold indexing did not finish within 120 seconds'
    cold=(time.perf_counter()-start)*1000
    assert first[1]['summary']['tokens']['total']==args.measurements*110
    # Pinned independent truth: 40 uncached input at $2.5/M, 60 cached at $0.25/M, 10 output at $15/M.
    unit_cost=Decimal('0.000265')
    assert Decimal(first[1]['summary']['price']['cost'])==args.measurements*unit_cost
    warm=[query()[0] for _ in range(5)]
    thread_ms,threads=query('threads')
    assert threads['summary']['tokens']['total']==args.measurements*110
    assert Decimal(threads['summary']['price']['cost'])==args.measurements*unit_cost
    append=[];rss_samples=[]
    for i in range(args.appends):
        with (source/'sessions'/'0.jsonl').open('a') as f:
            f.write(line(record('thread-0','extra-'+str(i))));f.flush();os.fsync(f.fileno())
        elapsed,value=query();append.append(elapsed)
        assert value['summary']['tokens']['total']==(args.measurements+i+1)*110
        assert Decimal(value['summary']['price']['cost'])==(args.measurements+i+1)*unit_cost
        rss_samples.append(int(subprocess.check_output(['ps','-o','rss=','-p',str(service.pid)]).strip()))
    def cpu_seconds():
        text=subprocess.check_output(['ps','-o','time=','-p',str(service.pid)],text=True).strip()
        parts=[float(v) for v in text.split(':')]
        return sum(v*60**i for i,v in enumerate(reversed(parts)))
    cpu_start=cpu_seconds();idle_start=time.perf_counter();time.sleep(5)
    idle_percent=100*(cpu_seconds()-cpu_start)/(time.perf_counter()-idle_start)
    rss=int(subprocess.check_output(['ps','-o','rss=','-p',str(service.pid)]).strip())
    size=sum(p.stat().st_size for p in (root/'data').rglob('*') if p.is_file())
    idle_deadline=idle_start+25
    while True:
        ended,status,usage=os.wait4(service.pid,os.WNOHANG)
        if ended:
            service.returncode=os.waitstatus_to_exitcode(status)
            break
        assert time.perf_counter()<idle_deadline,'service did not retire after idle timeout'
        time.sleep(.1)
    assert service.returncode==0,service.stderr.read().decode()
    idle_exit=(time.perf_counter()-idle_start)*1000
    result={'platform':os.uname().sysname+' '+os.uname().machine,'coreSha256':hashlib.sha256(core.read_bytes()).hexdigest(),'corpusSha256':raw.hexdigest(),'measurements':args.measurements,'operations':args.measurements,'threads':args.threads,'appends':args.appends,'coldSyncAndCliMs':round(cold,2),'warmCliMs':[round(v,2) for v in warm],'threadsCliMs':round(thread_ms,2),'appendSyncAndCliMs':[round(v,2) for v in append],'peakRssBytes':usage.ru_maxrss*(1 if os.uname().sysname=='Darwin' else 1024),'rssKiBAtEnd':rss,'indexBytes':size,'idleCpuPercentOver5s':round(idle_percent,3),'idleExitMs':round(idle_exit,2),'appendRssKiB':rss_samples,'correctness':'Each synthetic measurement contributes exactly 110 tokens and $0.000265; usage and threads agree, and appended amounts remain exact.','conditions':'Release core; new SQLite index; filesystem caches uncontrolled; service RSS only; no raw-body persistence; not a 24-hour or million-record acceptance.'}
    args.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
finally:
    if service.poll() is None:service.terminate();service.communicate(timeout=10)
    shutil.rmtree(root)
