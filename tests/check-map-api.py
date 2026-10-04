"""Verify public preparation boundaries and a real prepared archive's checksum."""
import hashlib, json, urllib.error, urllib.request
BASE='http://127.0.0.1:8125'
for body in [{'id':'../../private'},{'id':42},{'id':'world-mlt','source':'https://example.invalid/arbitrary'}]:
    request=urllib.request.Request(BASE+'/api/prepare-map-package',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
    try:
        data=json.load(urllib.request.urlopen(request))
        # Extra fields cannot select a source; the allowed ID uses its catalogue.
        assert body['id']=='world-mlt' and data['state']=='ready'
    except urllib.error.HTTPError as error:
        assert error.code==400 and body['id']!='world-mlt'
request=urllib.request.Request(BASE+'/api/prepare-map-package',data=b'x'*257,headers={'Content-Type':'application/json'})
try:urllib.request.urlopen(request);raise AssertionError('Oversized request accepted')
except urllib.error.HTTPError as error:assert error.code==400
state=json.load(urllib.request.urlopen(BASE+'/api/map-package?id=world-mlt'))
meta=state['package'];assert state['state']=='ready'
assert sum(part['bytes'] for part in meta['chunks'])==meta['bytes']
for part in meta['chunks']:
    data=urllib.request.urlopen(BASE+'/'+part['url'].removeprefix('./')).read()
    assert len(data)==part['bytes'] and hashlib.sha256(data).hexdigest()==part['sha256']
print('Map preparation rejects invalid IDs and oversized input; fixed-source archive hashes verified')
