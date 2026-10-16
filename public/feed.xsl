<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html" encoding="UTF-8" indent="yes" doctype-system="about:legacy-compat"/>
<xsl:template match="/">
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>订阅本站 · <xsl:value-of select="/rss/channel/title"/></title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
<style>
:root{--brand:#0d8a66;--brand2:#10a37a;--accent:#6366f1;--bg:#fbfcfd;--surface:#fff;--soft:#eef1f4;--t1:#0f172a;--t2:#475569;--t3:#64748b;--line:#e3e8ee;--brandsoft:rgba(16,163,122,.10);--shadow:0 18px 40px -16px rgba(15,23,42,.22);color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--brand:#34d399;--brand2:#10b981;--accent:#818cf8;--bg:#0d1117;--surface:#151a22;--soft:#1a2029;--t1:#e6edf3;--t2:#a8b3c1;--t3:#8591a0;--line:#252c37;--brandsoft:rgba(52,211,153,.10);--shadow:0 18px 44px -16px rgba(0,0,0,.7)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--t1);font:16px/1.8 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--brand)}
.nav{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:0 24px;height:64px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(12px)}
.nav a{display:flex;align-items:center;gap:10px;font-weight:750;color:var(--t1);text-decoration:none}
.nav img{width:28px;height:28px;border-radius:8px}
.nav .back{margin-left:auto;font-weight:600;font-size:14px;color:var(--brand)}
.wrap{max-width:760px;margin:0 auto;padding:48px 24px 72px}
.hero{position:relative;overflow:hidden;padding:32px;border-radius:20px;border:1px solid var(--line);background:linear-gradient(135deg,var(--brandsoft),color-mix(in srgb,var(--accent) 12%,transparent))}
.eyebrow{margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:.12em;color:var(--brand)}
h1{margin:0;font-size:clamp(26px,4vw,36px);line-height:1.3;font-weight:800}
.hero p{color:var(--t2);margin:12px 0 0}
.copy{display:flex;gap:10px;margin-top:22px;flex-wrap:wrap}
.copy input{flex:1;min-width:0;height:46px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--surface);color:var(--t1);font:14px "JetBrains Mono","SF Mono",Menlo,Consolas,monospace}
.copy button{height:46px;padding:0 22px;border:0;border-radius:12px;background:var(--brand);color:#fff;font-weight:650;font-size:15px;cursor:pointer;transition:transform .2s}
@media (prefers-color-scheme:dark){.copy button{color:#04241a}}
.copy button:hover{transform:translateY(-2px)}
.how{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:28px 0 8px}
.how div{padding:16px 18px;border-radius:14px;background:var(--surface);border:1px solid var(--line);font-size:14px;color:var(--t2);line-height:1.65}
.how b{display:block;color:var(--t1);margin-bottom:4px;font-size:15px}
h2{margin:44px 0 16px;font-size:22px;font-weight:750}
.item{display:block;padding:18px 20px;margin-bottom:14px;border-radius:16px;background:var(--surface);border:1px solid var(--line);text-decoration:none;transition:transform .25s,box-shadow .25s,border-color .25s}
.item:hover{transform:translateY(-3px);box-shadow:var(--shadow);border-color:color-mix(in srgb,var(--brand) 35%,var(--line))}
.item time{font-size:13px;color:var(--t3)}
.item h3{margin:4px 0 6px;font-size:17px;line-height:1.5;color:var(--t1)}
.item p{margin:0;font-size:14.5px;color:var(--t2);line-height:1.7}
footer{text-align:center;font-size:13px;color:var(--t3);padding:24px;border-top:1px solid var(--line)}
@media (max-width:640px){.wrap{padding:28px 18px 56px}.hero{padding:22px}.copy button{flex:1}}
</style>
</head>
<body>
<nav class="nav"><a href="/"><img src="/favicon.svg" alt=""/>程序员项目库</a><a class="back" href="/">← 返回博客</a></nav>
<main class="wrap">
  <section class="hero">
    <p class="eyebrow">RSS FEED</p>
    <h1>📡 订阅本站</h1>
    <p>这是本站的 RSS 订阅地址。把下面的链接添加到 RSS 阅读器，有新文章时会自动推送给你，不用反复打开网站查看。</p>
    <div class="copy">
      <input id="u" readonly="readonly" value="https://msnan.github.io/feed.xml" aria-label="RSS 订阅地址"/>
      <button id="b" type="button">复制链接</button>
    </div>
  </section>
  <div class="how">
    <div><b>什么是 RSS？</b>一种订阅网站更新的标准格式，阅读器会定期检查并汇总新文章。</div>
    <div><b>用什么阅读器？</b>Feedly、Inoreader、NetNewsWire、Folo 等都可以，粘贴上面的链接即可。</div>
    <div><b>不想装软件？</b>也可以在 <a href="https://github.com/MsNan">GitHub</a> 关注我，或直接收藏<a href="/">博客首页</a>。</div>
  </div>
  <h2>最新文章</h2>
  <xsl:for-each select="/rss/channel/item">
    <a class="item">
      <xsl:attribute name="href"><xsl:value-of select="link"/></xsl:attribute>
      <time><xsl:value-of select="substring(pubDate,6,11)"/></time>
      <h3><xsl:value-of select="title"/></h3>
      <p><xsl:value-of select="description"/></p>
    </a>
  </xsl:for-each>
</main>
<script><![CDATA[
document.getElementById('b').addEventListener('click',function(){var i=document.getElementById('u'),t=this;i.select();
var done=function(){t.textContent='已复制 ✓';setTimeout(function(){t.textContent='复制链接'},1800)};
if(navigator.clipboard){navigator.clipboard.writeText(i.value).then(done,function(){document.execCommand('copy');done()})}else{document.execCommand('copy');done()}});
]]></script>
<footer>© 2018-present 涛哥 · 程序员项目库</footer>
</body>
</html>
</xsl:template>
</xsl:stylesheet>
