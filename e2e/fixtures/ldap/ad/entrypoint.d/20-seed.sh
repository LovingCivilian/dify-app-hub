#!/bin/sh
# Seeds the AD-like test directory offline (samba-tool on the local sam.ldb; samba is not running yet).
# DNs: CN=<Given Surname>,CN=Users,DC=e2e,DC=hub,DC=test (svc-hub: CN=svc-hub,…).
set -eu
marker=/var/lib/samba/.e2e-seeded
[ -f "$marker" ] && exit 0
pw='E2e-Dir-Passw0rd'

samba-tool user add svc-hub 'E2e-Svc-Passw0rd' --description='dify-app-hub read-only service account'
samba-tool user add alice "$pw" --given-name=Alice --surname=Admin --mail-address=alice@e2e.hub.test
samba-tool user add bob "$pw" --given-name=Bob --surname=Builder --mail-address=bob@e2e.hub.test
samba-tool user add carol "$pw" --given-name=Carol --surname=Gone --mail-address=carol@e2e.hub.test
samba-tool user disable carol                                   # userAccountControl bit 2
samba-tool user add dave "$pw" --given-name=Dave --surname=Nomail # no mail: refused at first sign-in
samba-tool user add erin "$pw" --given-name=Erin --surname=Rename --mail-address=erin@e2e.hub.test # rename test
samba-tool user add frank "$pw" --given-name=Frank --surname=Smith --mail-address=frank@e2e.hub.test
samba-tool user rename frank --force-new-cn='Smith\, Frank'     # DN CN=Smith\, Frank,CN=Users,…

samba-tool group add hub-admins
samba-tool group add hub-engineering
samba-tool group add hub-backend
samba-tool group add rnd-team
samba-tool group rename rnd-team --force-new-cn='R&D (Berlin)\, Team' # ( ) \ in a filter value: RFC 4515 escaping
samba-tool group addmembers hub-admins alice
samba-tool group addmembers hub-engineering hub-backend         # nesting: in-chain rule 1.2.840.113556.1.4.1941
samba-tool group addmembers hub-backend bob
samba-tool group addmembers rnd-team frank

touch "$marker"
