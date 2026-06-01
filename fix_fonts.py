
import re,sys
with open('/home/user/input/input_1.html','r',encoding='utf-8') as f:
    h=f.read()
h=re.sub(r'<link[^>]+googleapis\.com[^>]+>\n?','',h)
nl='<link href="https://fonts.googleapis.com/css2?family=Sarabun:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">\n'
h=h.replace('<meta name="viewport"',nl+'<meta name="viewport"',1)
for p,r in [
    (r"font-family\s*:\s*['\"]?Plus Jakarta Sans['\"]?\s*,\s*['\"]?Sarabun['\"]?\s*,\s*sans-serif","font-family:'Sarabun',sans-serif"),
    (r"font-family\s*:\s*['\"]?Plus Jakarta Sans['\"]?\s*,\s*sans-serif","font-family:'Sarabun',sans-serif"),
    (r"font-family\s*:\s*['\"]?Plus Jakarta Sans['\"]?","font-family:'Sarabun',sans-serif"),
    (r"font-family\s*:\s*['\"]?IBM Plex Mono['\"]?\s*,\s*monospace","font-family:'Sarabun',sans-serif"),
    (r"font-family\s*:\s*['\"]?IBM Plex Mono['\"]?","font-family:'Sarabun',sans-serif"),
]:
    h=re.sub(p,r,h,flags=re.IGNORECASE)
def up(m):
    v=float(m.group(1))
    return 'font-size:12px' if v<12 else m.group(0)
h=re.sub(r'font-size\s*:\s*([\d.]+)px',up,h)
css="\n*,*::before,*::after{font-family:'Sarabun',sans-serif!important;-webkit-font-smoothing:antialiased;}\nbody{font-family:'Sarabun',sans-serif!important;font-size:15px;line-height:1.6;}\ntable,td,th,input,select,textarea,label,span,p,div,button,a{font-family:'Sarabun',sans-serif!important;}\n"
h=h.replace('</style>',css+'\n</style>',1)
with open('/home/user/output/index.html','w',encoding='utf-8') as f:
    f.write(h)
rj=len(re.findall(r'Plus Jakarta Sans',h,re.IGNORECASE))
ri=len(re.findall(r'IBM Plex Mono',h,re.IGNORECASE))
sm=[float(m.group(1)) for m in re.finditer(r'font-size\s*:\s*([\d.]+)px',h) if float(m.group(1))<12]
print(f"OK size={len(h)} jakarta={rj} ibm={ri} small<12={len(sm)}")
