include ../Makefile.include

all: collection dissemination query

collection: collection.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json 50

dissemination: dissemination.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json 70 1

query: query.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json 90

clean:
	rm -rf results
