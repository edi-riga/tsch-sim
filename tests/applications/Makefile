include ../Makefile.include

all: collection dissemination query

collection: collection.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json 50

dissemination: dissemination.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json 70 1

query: query.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json 90 1
	$(NODE) --harmony --experimental-modules  ../check_stats_value.mjs results/stats.json -1 app_num_replied \> 0

clean:
	rm -rf results
