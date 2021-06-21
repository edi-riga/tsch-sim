include ../Makefile.include

all: duty-cycle

duty-cycle: duty-cycle.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_stats_value.mjs results/stats.json 1 radio_duty_cycle = 2.02
	$(NODE) --harmony --experimental-modules  ../check_stats_value.mjs results/stats.json 1 radio_duty_cycle_joined = 2.02

clean:
	rm -rf results
