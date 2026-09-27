import pathlib
src=pathlib.Path('src')
css=(src/'style.css').read_text()
body=(src/'body.html').read_text()
js='\n'.join((src/f).read_text() for f in ['catalog.js','dxf.js','engine.js','pdfplan.js','demo.js','app.js'])
vendor='<script>\n'+(src/'vendor/pdf.min.js').read_text()+'\n</script>\n<script type="text/plain" id="pdfjs-worker">\n'+(src/'vendor/pdf.worker.min.js').read_text()+'\n</script>\n<script>\n'+(src/'vendor/jspdf.umd.min.js').read_text()+'\n</script>\n'
head='''<title>WiFi Coverage Planner</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
'''+css+'</style>\n'
content=head+body+vendor+'<script>\n'+js+'\n</script>\n'
pathlib.Path('dist/artifact.html').write_text(content)
full='<!DOCTYPE html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'+head+'</head>\n<body>\n'+body+vendor+'<script>\n'+js+'\n</script>\n</body>\n</html>\n'
pathlib.Path('dist/WiFiCoverage.html').write_text(full)
print(len(full))
