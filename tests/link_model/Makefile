include ../Makefile.include

all: fixed fixed-per-channel-quality udgm udgm-constant-loss logistic-loss pister-hack trace

fixed: fixed.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules ../check_par.mjs results/stats.json

fixed-per-channel-quality: fixed-per-channel-quality.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules ../check_par.mjs results/stats.json

udgm: udgm.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules ../check_par.mjs results/stats.json

udgm-constant-loss: udgm-constant-loss.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules ../check_par.mjs results/stats.json

logistic-loss: logistic-loss.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules ../check_par.mjs results/stats.json

pister-hack: pister-hack.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules ../check_par.mjs results/stats.json

trace: trace.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules ../check_par.mjs results/stats.json

clean:
	rm -rf results
