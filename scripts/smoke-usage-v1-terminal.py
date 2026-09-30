"""Exercise the actual terminal with synthetic Codex logs; no private source reads.

Run after building Wombat:
  python3 -m venv /tmp/wombat-pty-venv
  /tmp/wombat-pty-venv/bin/pip install -r scripts/requirements-terminal.txt
  /tmp/wombat-pty-venv/bin/python scripts/smoke-usage-v1-terminal.py

WOMBAT_CLI_ENTRY may select another built or installed wombat.js entry.
"""
import datetime, errno, fcntl, hashlib, json, os, pathlib, pty, select, shutil, signal, struct, subprocess, tempfile, termios, time
import pyte

ROOT = pathlib.Path(__file__).resolve().parents[1]
NODE = shutil.which('node')
ENTRY = pathlib.Path(os.environ.get('WOMBAT_CLI_ENTRY', str(ROOT/'dist/wombat.js'))).resolve()

class Screen(pyte.Screen):
    """Let pyte answer terminal device/status queries through the PTY."""
    def __init__(self, columns, lines, write):
        self.write = write
        super().__init__(columns, lines)
    def write_process_input(self, data):
        self.write(data.encode('utf8'))

class Terminal:
    def __init__(self, env, width, height, args=None):
        self.master, self.slave = pty.openpty()
        self.original = termios.tcgetattr(self.slave)
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack('HHHH', height, width, 0, 0))
        self.screen = Screen(width, height, lambda data: os.write(self.master, data))
        self.stream = pyte.ByteStream(self.screen)
        self.process = subprocess.Popen([NODE, str(ENTRY)] + (args or []), stdin=self.slave, stdout=self.slave, stderr=self.slave, cwd=ROOT, env=env, start_new_session=True)
        self.raw = b''
    def collect(self, duration=.08):
        deadline = time.monotonic()+duration
        while time.monotonic()<deadline:
            if select.select([self.master], [], [], max(0, min(.05, deadline-time.monotonic())))[0]:
                try:
                    chunk = os.read(self.master, 65536)
                    if not chunk: break
                    self.raw += chunk
                    self.stream.feed(chunk)
                except OSError as error:
                    if error.errno == errno.EIO: break
                    raise
    def text(self, mark=0):
        # mark is retained for existing journeys; a diff-rendered terminal must
        # always be asserted against its current screen, not the latest bytes.
        return '\n'.join(self.screen.display)
    def expect(self, text, mark=0, timeout=12):
        deadline=time.monotonic()+timeout
        while text not in self.text(mark):
            self.collect()
            if self.process.poll() is not None or time.monotonic()>deadline:
                raise AssertionError(f'Expected {text!r}; got {self.text(mark)[-3000:]}')
    def key(self, text, expected=None):
        self.collect();mark=len(self.raw);os.write(self.master,text.encode())
        self.collect(.16)
        if expected:self.expect(expected,mark)
        return mark
    def resize(self, width, height, expected):
        self.collect();mark=len(self.raw)
        self.screen.resize(lines=height, columns=width)
        fcntl.ioctl(self.slave,termios.TIOCSWINSZ,struct.pack('HHHH',height,width,0,0))
        os.kill(self.process.pid,signal.SIGWINCH)
        self.expect(expected,mark)
    def finish(self, code=0):
        deadline=time.monotonic()+10
        while self.process.poll() is None and time.monotonic()<deadline:self.collect()
        assert self.process.poll()==code, (self.process.poll(),self.text()[-2000:])
        self.collect()
        mask=termios.ICANON|termios.ECHO
        assert termios.tcgetattr(self.slave)[3]&mask==self.original[3]&mask,'terminal input/echo mode not restored'
        assert b'\x1b[?1049h' in self.raw,'alternate screen was not entered'
        assert self.raw.rfind(b'\x1b[?1049l')>self.raw.rfind(b'\x1b[?1049h'),'alternate screen was not restored'
        assert self.raw.rfind(b'\x1b[?25h')>self.raw.rfind(b'\x1b[?25l'),'cursor was not restored'
    def close(self):
        try:
            if self.process.poll() is None:
                os.killpg(self.process.pid,signal.SIGTERM)
                deadline=time.monotonic()+3
                while self.process.poll() is None and time.monotonic()<deadline:self.collect()
                if self.process.poll() is None:
                    os.killpg(self.process.pid,signal.SIGKILL)
                    self.process.wait(timeout=3)
                self.collect()
        finally:
            os.close(self.master);os.close(self.slave)

checks=[]
with tempfile.TemporaryDirectory(prefix='wombat-v1-pty-') as temporary:
    folder=pathlib.Path(temporary);codex=folder/'codex';sessions=codex/'sessions';sessions.mkdir(parents=True)
    day=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=1)).strftime('%Y-%m-%d')
    events=[]
    def event(kind,payload,second):events.append({'timestamp':f'{day}T12:00:{second:02d}Z','type':kind,'payload':payload})
    event('session_meta',{'id':'synthetic-thread','cwd':'/synthetic/project','cli_version':'synthetic-v1'},0)
    event('turn_context',{'turn_id':'synthetic-turn','model':'gpt-5.4','model_provider':'openai','effort':'high'},1)
    event('event_msg',{'type':'task_started','turn_id':'synthetic-turn'},2)
    event('response_item',{'type':'function_call','name':'read_file','call_id':'synthetic-call','arguments':'{"path":"/synthetic/project/README.md"}'},3)
    event('event_msg',{'type':'token_usage_record','thread_id':'synthetic-thread','turn_id':'synthetic-turn','response_id':'synthetic-response','usage':{'input_tokens':100000,'cached_input_tokens':20000,'cache_write_input_tokens':0,'output_tokens':20000,'reasoning_output_tokens':3000,'total_tokens':120000}},4)
    event('event_msg',{'type':'task_complete','turn_id':'synthetic-turn'},5)
    (sessions/'rollout-synthetic.jsonl').write_text(''.join(json.dumps(row)+'\n' for row in events))
    (codex/'session_index.jsonl').write_text(json.dumps({'id':'synthetic-thread','thread_name':'终端验收样本','updated_at':f'{day}T12:01:00Z'})+'\n')
    env={**os.environ,'WOMBAT_LANG':'zh','CODEX_HOME':str(codex),'WOMBAT_DATA_HOME':str(folder/'data'),'TERM':'xterm-256color','WOMBAT_THEME':'forest'}
    env.pop('NO_COLOR',None)
    refresh=subprocess.run([NODE,str(ENTRY),'refresh','--root',str(codex),'--json'],env=env,cwd=ROOT,capture_output=True,text=True)
    assert refresh.returncode in (0,2),refresh.stderr+refresh.stdout
    for width,height in [(40,24),(80,24),(120,32)]:
        terminal=Terminal(env,width,height,['--lang','en'])
        try:
            terminal.expect('Daily report')
            terminal.key('l','日报')
            terminal.key('l','Daily report')
            terminal.key('g','Weekly report')
            terminal.key('2','Conversations')
            terminal.expect('终端验收样本')
            terminal.key('f','Filters')
            terminal.key('\x1b','Conversations')
            terminal.key('q');terminal.finish(0)
            checks.append({'columns':width,'rows':height,'journey':'English launch → Chinese → English → weekly report → source title → filters → quit','terminalRestored':True})
        finally:terminal.close()
    for width,height in [(40,14),(80,24),(120,32)]:
        terminal=Terminal(env,width,height)
        try:
            terminal.expect('Wombat');terminal.expect('Token')
            terminal.key('\t','Wombat / 对话');terminal.key('\r','第 1 轮')
            terminal.key('\r','时间顺序')
            terminal.key('\x1b[B');terminal.key('\r','消耗优先')
            terminal.key('\x1b[B');terminal.key('\r','非缓存输入')
            terminal.key('\x1b','Wombat / 对话');terminal.key('\t','Wombat / 日报')
            terminal.key('q');terminal.finish(2 if json.loads(refresh.stdout)['quality']['status']=='partial' else 0)
            checks.append({'columns':width,'rows':height,'journey':'用量 → 对话 → 轮次展开 → 按Token排序 → 分类费用 → 返回 → 切换入口 → 退出','terminalRestored':True,'alternateScreenRestored':True,'cursorRestored':True})
        finally:terminal.close()
    terminal=Terminal(env,80,24)
    try:
        terminal.expect('gpt-5.4')
        terminal.key('u','联网更新价表')
        assert 'Wombat / 价格表' in terminal.text()
        terminal.expect('缓存读取')
        terminal.key('\r','别名')
        terminal.key('s','长上下文价格')
        terminal.key('s','标准价格')
        terminal.key('n','第 2 /')
        terminal.key('p','第 1 /')
        terminal.key('\x1b','gpt-5.4')
        assert '120,000' in terminal.text() and '$0.51' in terminal.text()
        terminal.key('q');terminal.finish(0)
        checks.append({'columns':80,'rows':24,'journey':'U 查看完整价表 → 展开模型 → S 切换档位 → N/P 翻页 → Esc 返回用量 → 退出','priceDialogPreservesSnapshot':True,'terminalRestored':True,'alternateScreenRestored':True,'cursorRestored':True})
    finally:terminal.close()
    # A canceled date draft leaves the current usage intact; applying a preset changes it.
    terminal=Terminal(env,80,24)
    try:
        terminal.expect('gpt-5.4')
        terminal.key('f','Wombat / 筛选');terminal.key('\r','本月');terminal.key('\x1b[B');terminal.key('\r','今天')
        assert 'Wombat / 时间' not in terminal.text(),'select navigated away from the form'
        mark=terminal.key('\x1b','gpt-5.4')
        assert 'Wombat / 日报' in terminal.text(mark),'cancel did not return to the usage page'
        terminal.key('f','Wombat / 筛选');terminal.key('\r','本月');terminal.key('\x1b[B');terminal.key('\r','今天')
        mark=terminal.key('a','这个范围暂无记录')
        assert 'Wombat / 日报' in terminal.text(mark),'applying a preset left the usage page'
        assert 'gpt-5.4' not in terminal.text(mark),'today preset retained yesterday records'
        terminal.key('f','Wombat / 筛选');terminal.key('\r','本月');terminal.key('\x1b[B');terminal.key('\r','近7天')
        terminal.key('a','gpt-5.4')
        terminal.key('q');terminal.finish(0)
        checks.append({'columns':80,'rows':24,'journey':'F 时间今天 → Esc 取消保留原结果 → F 时间今天 → A 应用空结果 → 近7天恢复结果 → 退出','filterCancelPreservesPage':True,'timePresetApplied':True,'terminalRestored':True,'alternateScreenRestored':True,'cursorRestored':True})
    finally:terminal.close()
    terminal=Terminal(env,80,24)
    try:
        terminal.expect('gpt-5.4')
        terminal.key('f','Wombat / 筛选');terminal.key('\t');terminal.key('\r','推理强度')
        terminal.key('\t');terminal.key('\r','/synthetic/project');terminal.key('\x1b[B');terminal.key('\r')
        terminal.key('\t');terminal.key('\r','gpt-5.4');terminal.key('\x1b[B');terminal.key('\r')
        terminal.key('a','Wombat / 日报')
        assert '120,000' in terminal.text() and '$0.51' in terminal.text()
        terminal.key('\t','Wombat / 对话');terminal.key('f','标题 / 项目搜索')
        terminal.key('\t');terminal.key('\r','/synthetic/project');terminal.key('\x1b[B');terminal.key('\r')
        terminal.key('a','终端验收样本')
        terminal.key('q');terminal.finish(0)
        checks.append({'columns':80,'rows':24,'journey':'用量项目/模型下拉选择 → 应用 → 对话项目下拉选择 → 应用 → 退出','filterCandidatesApplied':True,'terminalRestored':True,'alternateScreenRestored':True,'cursorRestored':True})
    finally:terminal.close()
    for detail in [False,True]:
        terminal=Terminal(env,80,24)
        try:
            terminal.expect('gpt-5.4')
            if detail:
                terminal.key('\t','Wombat / 对话');terminal.key('\r','第 1 轮')
            current='终端验收样本' if detail else 'Wombat / 日报'
            mark=terminal.key('?','金额依据 · 标准 API 价格折算')
            assert current in terminal.text(mark),'opening footer explanation navigated away from the current page'
            assert ('12万 Token' if detail else '120,000') in terminal.text(mark),'opening footer explanation hid the current page values'
            mark=terminal.key('?','第 1 轮' if detail else 'gpt-5.4')
            assert current in terminal.text(mark),'closing footer explanation navigated away from the current page'
            assert '标准 API 价格折算' not in terminal.text(mark),'footer explanation did not close'
            terminal.key('q');terminal.finish(0)
            checks.append({'columns':80,'rows':24,'journey':('轮次' if detail else '用量')+' → ? 页尾金额说明 → ? 收起保留当前页 → 退出','footerDisclosurePreservesPage':True,'terminalRestored':True,'alternateScreenRestored':True,'cursorRestored':True})
        finally:terminal.close()
    # First launch must discover only the isolated synthetic CODEX_HOME and collect without Enter.
    first_data=folder/'first-launch-data'
    first_env={**env,'WOMBAT_DATA_HOME':str(first_data)}
    terminal=Terminal(first_env,80,24)
    try:
        terminal.expect('gpt-5.4')
        assert (first_data/'live-v1/index.sqlite').is_file(),'first launch did not create an index'
        assert not (first_data/'usage-v3/latest.json').exists(),'automatic sync unexpectedly exported a snapshot'
        terminal.key('q');terminal.finish(0)
        checks.append({'columns':80,'rows':24,'journey':'首次无快照 → 自动采集合成来源 → 用量表 → 退出','automaticCollection':True,'terminalRestored':True,'alternateScreenRestored':True,'cursorRestored':True})
    finally:terminal.close()
    terminal=Terminal(env,80,24)
    try:
        terminal.expect('gpt-5.4')
        terminal.resize(40,14,'F 筛选')
        terminal.resize(120,32,'缓存创建')
        terminal.resize(80,24,'gpt-5.4')
        terminal.key('q');terminal.finish(0)
        checks.append({'columns':[80,40,120,80],'rows':[24,14,32,24],'journey':'用量表 → 窄屏 → 宽屏 → 普通屏 → 退出','terminalRestored':True,'alternateScreenRestored':True,'cursorRestored':True})
    finally:terminal.close()
    terminal=Terminal(env,80,24)
    try:
        terminal.expect('gpt-5.4')
        colors=[]
        for _ in range(3):
            terminal.collect();mark=len(terminal.raw)
            terminal.key('t','gpt-5.4');terminal.collect()
            colors.append({cell.bg for row in terminal.screen.buffer.values() for cell in row.values() if cell.bg != 'default'})
            assert '120,000' in terminal.text(mark) and '$0.51' in terminal.text(mark),'theme changed displayed usage'
        assert all(colors) and len({frozenset(values) for values in colors})==3,'theme cycle did not change colors'
        terminal.key('\t','Wombat / 对话');terminal.key('\r','第 1 轮')
        terminal.key('q');terminal.finish(0)
        checks.append({'columns':80,'rows':24,'journey':'森林 → 浅色 → 石墨 → 森林 → 对话 → 轮次 → 退出','themeCyclePreservesData':True,'terminalRestored':True,'alternateScreenRestored':True,'cursorRestored':True})
    finally:terminal.close()
    terminal=Terminal(env,80,24)
    try:
        terminal.expect('gpt-5.4');terminal.key('\x03');terminal.finish(130)
        checks.append({'columns':80,'rows':24,'journey':'交互首页 → Ctrl+C 退出','exitCode':130,'terminalRestored':True,'alternateScreenRestored':True,'cursorRestored':True})
    finally:terminal.close()
    # Report buttons must query older records, not merely regroup the latest seven days.
    report_source=folder/'report-source';(report_source/'sessions').mkdir(parents=True)
    today=datetime.datetime.now(datetime.timezone.utc).date()
    for index,(ago,factor) in enumerate([(0,1),(10,2),(60,4),(400,8)]):
        stamp=f'{today-datetime.timedelta(days=ago)}T00:00:01Z'
        tid=f'report-{index}'
        report_rows=[
            {'timestamp':stamp,'type':'session_meta','payload':{'id':tid}},
            {'timestamp':stamp,'type':'turn_context','payload':{'turn_id':tid,'model':'gpt-5.4','model_provider':'openai'}},
            {'timestamp':stamp,'type':'event_msg','payload':{'type':'token_usage_record','thread_id':tid,'turn_id':tid,'response_id':tid,'usage':{'input_tokens':100000*factor,'cached_input_tokens':20000*factor,'cache_write_input_tokens':0,'output_tokens':20000*factor,'reasoning_output_tokens':0,'total_tokens':120000*factor}}},
        ]
        (report_source/'sessions'/f'{tid}.jsonl').write_text(''.join(json.dumps(row)+'\n' for row in report_rows))
    report_env={**env,'WOMBAT_DATA_HOME':str(folder/'report-data'),'CODEX_HOME':str(report_source)}
    terminal=Terminal(report_env,120,32,['--timezone','UTC'])
    try:
        terminal.expect('120,000')
        terminal.key('g','Wombat / 周报');terminal.expect('360,000')
        terminal.key('g','Wombat / 月报');terminal.expect('840,000')
        terminal.key('g','Wombat / 日报');terminal.expect('120,000')
        terminal.key('q');terminal.finish(0)
        checks.append({'columns':120,'rows':32,'journey':'日报近7天 → 周报近4周 → 月报近12个月 → 日报 → 退出','dailyTokens':120000,'weeklyTokens':360000,'monthlyTokens':840000,'terminalRestored':True,'alternateScreenRestored':True,'cursorRestored':True})
    finally:terminal.close()
    legacy=folder/'legacy-snapshot.json'
    legacy.write_text(json.dumps({'schemaVersion':2,'snapshotId':'synthetic-legacy','createdAt':f'{day}T12:00:00Z','catalog':{'sessions':[{'id':'legacy-thread','title':'旧快照样本','upstreamSessionId':'legacy-native','sourceFile':'/synthetic/log'}],'ledger':[{'id':'legacy-row','sessionId':'legacy-thread','totalTokens':11,'timestamp':f'{day}T12:00:00Z','costUsd':0.01,'pricingCoverage':'partial'}]}}))
    terminal=Terminal(env,80,24,['--snapshot',str(legacy)])
    try:
        terminal.expect('Wombat');terminal.key('\t','旧快照样本');terminal.key('\r','旧快照没有轮次明细');terminal.key('\x1b','旧快照样本');terminal.key('q');terminal.finish(2)
        checks.append({'columns':80,'rows':24,'journey':'外部旧快照 → 对话 → 明细不可用 → 返回对话 → 退出','terminalRestored':True,'alternateScreenRestored':True,'cursorRestored':True})
    finally:terminal.close()
    terminal=Terminal(env,120,32)
    try:
        terminal.expect('120,000')
        appended={'timestamp':f'{day}T12:00:06Z','type':'event_msg','payload':{'type':'token_usage_record','thread_id':'synthetic-thread','turn_id':'synthetic-turn','response_id':'synthetic-live-response','usage':{'input_tokens':100000,'cached_input_tokens':20000,'cache_write_input_tokens':0,'output_tokens':20000,'reasoning_output_tokens':3000,'total_tokens':120000}}}
        started=time.monotonic()
        with (sessions/'rollout-synthetic.jsonl').open('a') as log:
            log.write(json.dumps(appended)+'\n');log.flush();os.fsync(log.fileno())
        terminal.expect('240,000')
        latency_ms=round((time.monotonic()-started)*1000,2)
        terminal.key('q');terminal.finish(0)
        checks.append({'columns':120,'rows':32,'journey':'日志追加 → 无按键自动显示新总量 → 退出','tokensBefore':120000,'tokensAfter':240000,'observedLatencyMs':latency_ms,'terminalRestored':True})
    finally:terminal.close()
    terminal=Terminal(env,120,32,['--snapshot',json.loads(refresh.stdout)['snapshotRef']['snapshotId']])
    try:
        terminal.expect('120,000');terminal.collect(1.3)
        assert '240,000' not in terminal.text(),'fixed snapshot unexpectedly followed live data'
        terminal.key('q');terminal.finish(0)
        checks.append({'columns':120,'rows':32,'journey':'固定快照保持原总量 → 退出','tokens':120000,'terminalRestored':True})
    finally:terminal.close()

print(json.dumps({'method':'actual POSIX PTY with pyte 0.8.2 screen emulation; synthetic Codex source; not a browser test or user study','platform':os.uname().machine,'nodeVersion':subprocess.check_output([NODE,'--version'],text=True).strip(),'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'binarySha256':{'core':hashlib.sha256((ENTRY.parent/'wombat-core').read_bytes()).hexdigest(),'cli':hashlib.sha256(ENTRY.read_bytes()).hexdigest()},'javascriptSha256':{file.name:hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(ENTRY.parent.glob('*.js'))},'checks':checks},ensure_ascii=False,indent=2))
