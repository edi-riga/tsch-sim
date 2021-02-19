include ../Makefile.include

all: empty eb keepalive desync join-hopseq join-hopseq-nojoin slot-duration non-standard-slots subslots \
	start-joined different-hopping-sequences

empty: empty.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules ../check_pdr.mjs results/stats.json
	$(NODE) --harmony --experimental-modules ../check_log_stats.mjs results/log.txt

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
	grep "keepalive packet sent: ok" results/log.txt > /dev/null

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

different-hopping-sequences: different-hopping-sequences.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules ../check_bad_par.mjs results/stats.json

clean:
	rm -rf results
