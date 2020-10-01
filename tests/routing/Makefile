include ../Makefile.include

all: nullrouting lf rpl-leaf rpl-dao-ack rpl-no-dao-ack rpl-probing rpl-no-probing rpl-recover-2nodes rpl-recover-3nodes rpl-loops rpl-loops-drop \
	rpl-of0 rpl-recover-2nodes-of0 rpl-recover-3nodes-of0 rpl-loops-of0 rpl-loops-drop-of0

nullrouting: nullrouting.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json

lf: lf.json 
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json

rpl-leaf: rpl-leaf.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "using MRHOF objective function" results/log.txt > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json
	grep "id=2" results/log.txt | grep "skip sending EB" > /dev/null
	grep "id=3" results/log.txt | grep "skip sending EB" > /dev/null
	grep "id=4" results/log.txt | grep "skip sending EB" > /dev/null
	grep "id=5" results/log.txt | grep "skip sending EB" > /dev/null
	grep "id=6" results/log.txt | grep "skip sending EB" > /dev/null
	grep "id=7" results/log.txt | grep "skip sending EB" > /dev/null
	grep "id=8" results/log.txt | grep "skip sending EB" > /dev/null
	grep "id=9" results/log.txt | grep "skip sending EB" > /dev/null
	grep "id=10" results/log.txt | grep "skip sending EB" > /dev/null

rpl-dao-ack: rpl-dao-ack.json 
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json
	grep "id=2" results/log.txt | grep "got DAO ACK seqno" | grep "status 0" > /dev/null
	grep "id=3" results/log.txt | grep "got DAO ACK seqno" | grep "status 0" > /dev/null

rpl-no-dao-ack: rpl-no-dao-ack.json 
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json
	../invert_grep.sh 'DAO ACK' results/log.txt

rpl-probing: rpl-probing.json 
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json
	grep "id=2" results/log.txt | grep "probing node 3" > /dev/null

rpl-no-probing: rpl-no-probing.json 
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json
	../invert_grep.sh "probing node" results/log.txt

rpl-recover-2nodes: rpl-recover-2nodes.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json

rpl-recover-3nodes: rpl-recover-3nodes.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json

rpl-loops: rpl-loops.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "loop detected, attempting repair" results/log.txt > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json

rpl-loops-drop: rpl-loops-drop.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "rank error and loop detected, dropping" results/log.txt > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json

rpl-of0: rpl-of0.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "using OF0 objective function" results/log.txt > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json 70

rpl-recover-2nodes-of0: rpl-recover-2nodes-of0.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "using OF0 objective function" results/log.txt > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json

rpl-recover-3nodes-of0: rpl-recover-3nodes-of0.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "using OF0 objective function" results/log.txt > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json

rpl-loops-of0: rpl-loops-of0.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "using OF0 objective function" results/log.txt > /dev/null
	grep "loop detected, attempting repair" results/log.txt > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json

rpl-loops-drop-of0: rpl-loops-drop-of0.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "using OF0 objective function" results/log.txt > /dev/null
	grep "rank error and loop detected, dropping" results/log.txt > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json

clean:
	rm -rf results
