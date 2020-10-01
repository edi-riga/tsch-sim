include ../Makefile.include

all: fragmentation no-fragmentation

fragmentation: fragmentation.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "id=2" results/log.txt | grep "packet reassembly started, seqnum=1 from=3"
	grep "id=2" results/log.txt | grep "packet reassembly completed, seqnum=1 from=3"
	grep "id=1" results/log.txt | grep "packet reassembly started, seqnum=1 from=2"
	grep "id=1" results/log.txt | grep "packet reassembly completed, seqnum=1 from=2"
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json 100

no-fragmentation: no-fragmentation.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "id=2" results/log.txt | grep "dropping app packet seqnum=1 for=1 to=1: too big"
	grep "id=3" results/log.txt | grep "dropping app packet seqnum=1 for=1 to=2: too big"

clean:
	rm -rf results
