const {createEngine}=require('./proxy');
const e=createEngine();
e.start(8888).then(()=>{
  console.log('PROXY_UP', e.isRunning());
  const http=require('http');
  const req=http.request({host:'127.0.0.1', port:8888, method:'GET', path:'http://example.com/', headers:{host:'example.com'}}, res=>{
    let d=0;
    res.on('data',c=>d+=c.length);
    res.on('end',()=>{
      console.log('CLIENT_GOT', res.statusCode, d, 'bytes');
      setTimeout(()=>{
        const ss=e.listSessions();
        console.log('SESSIONS', ss.length);
        const s=ss[0];
        console.log(JSON.stringify({method:s.method,url:s.url,status:s.status,bytes:s.responseBodyBytes,elapsed:s.elapsed,bodyHead:(s.responseBody||'').slice(0,60)}));
        e.stop().then(()=>process.exit(0));
      },300);
    });
  });
  req.on('error',er=>{console.log('ERR',er.message);process.exit(1)});
  req.end();
});
