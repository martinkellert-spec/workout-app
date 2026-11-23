import zipfile, re, sys, xml.etree.ElementTree as ET
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
z=zipfile.ZipFile(sys.argv[1])
ss=[]
if 'xl/sharedStrings.xml' in z.namelist():
    for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',ns):
        ss.append(''.join(t.text or '' for t in si.iter('{%s}t'%ns['m'])))
wb=ET.fromstring(z.read('xl/workbook.xml'))
rels=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
rmap={r.get('Id'):r.get('Target') for r in rels}
for sh in wb.find('m:sheets',ns):
    rid=sh.get('{%s}id'%ns['r']); target=rmap[rid].lstrip('/')
    if not target.startswith('xl/'): target='xl/'+target
    print('=== SHEET:', sh.get('name'))
    x=ET.fromstring(z.read(target))
    for row in x.iter('{%s}row'%ns['m']):
        vals=[]
        for c in row.findall('m:c',ns):
            t=c.get('t'); v=c.find('m:v',ns); f=c.find('m:f',ns)
            if t=='s' and v is not None: val=ss[int(v.text)]
            elif t=='inlineStr': val=''.join(x.text or '' for x in c.iter('{%s}t'%ns['m']))
            else: val=v.text if v is not None else ''
            if val!='' : vals.append(f"{c.get('r')}={val}")
        if vals: print(' | '.join(vals))
