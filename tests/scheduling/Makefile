include ../Makefile.include

all: orchestra-rb-ns orchestra-rb-storing orchestra-sb-storing orchestra-special-for-root orchestra-link-based lf 6tisch-min 100percent-line 100percent-star

orchestra-rb-ns: orchestra-rb-ns.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "initializing rule unicast per neighbor non-storing" results/log.txt > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json 90.0

orchestra-rb-storing: orchestra-rb-storing.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "initializing rule unicast per neighbor storing" results/log.txt > /dev/null
	grep "storing rule, receiver based" results/log.txt > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json 90.0

orchestra-sb-storing: orchestra-sb-storing.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "initializing rule unicast per neighbor storing" results/log.txt > /dev/null
	grep "storing rule, sender based" results/log.txt > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json 95.0

orchestra-special-for-root: orchestra-special-for-root.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "initializing rule special for root" results/log.txt > /dev/null
	grep "initializing rule unicast per neighbor storing" results/log.txt > /dev/null
	grep "storing rule, receiver based" results/log.txt > /dev/null
	grep "special_for_root_select_packet: use the root rule" results/log.txt > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json

orchestra-link-based: orchestra-link-based.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "initializing rule unicast per neighbor link based" results/log.txt > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json 90.0

6tisch-min: 6tisch-min.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "initializing 6tisch minimal" results/log.txt > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json 95.0

lf: lf.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "initializing leaf-and-forwarder scheduler" results/log.txt > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json 95.0

100percent-line: 100percent-line.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_good_par.mjs results/stats.json

100percent-star: 100percent-star.json
	@echo "\nTest group '$(shell basename `pwd`)', test target '$@'..."
	@rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_good_par.mjs results/stats.json

clean:
	rm -rf results
