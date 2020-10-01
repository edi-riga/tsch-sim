include ../Makefile.include

all: eb keepalive desync join-hopseq join-hopseq-nojoin slot-duration non-standard-slots subslots start-joined

eb: eb.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules ../check_pdr.mjs results/stats.json
	grep "add a new EB packet" results/log.txt > /dev/null

keepalive: keepalive.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules ../check_pdr.mjs results/stats.json
	grep "send keepalive packet to=1" results/log.txt > /dev/null

desync: desync.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "leaving network, did not resynchronize" results/log.txt > /dev/null

join-hopseq: join-hopseq.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules ../check_pdr.mjs results/stats.json

join-hopseq-nojoin: join-hopseq-nojoin.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "PDR=0.00%" results/log.txt > /dev/null

slot-duration: slot-duration.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules ../check_pdr.mjs results/stats.json
	../invert_grep.sh "asn=60000" results/log.txt > /dev/null
	../invert_grep.sh "asn=60001" results/log.txt > /dev/null

non-standard-slots: non-standard-slots.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules ../check_pdr.mjs results/stats.json
	../invert_grep.sh "asn=60000" results/log.txt > /dev/null
	../invert_grep.sh "asn=60001" results/log.txt > /dev/null

subslots: subslots.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules ../check_pdr.mjs results/stats.json

start-joined: start-joined.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules ../check_pdr.mjs results/stats.json

clean:
	rm -rf results
