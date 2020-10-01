include ../Makefile.include

all: line random-waypoint

line: line.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "id=6" results/log.txt | grep "at 3600.000 pos is 40.000" > /dev/null
	grep "id=7" results/log.txt | grep "at 3600.000 pos is 0.000" > /dev/null
	grep "id=8" results/log.txt | grep "at 3600.000 pos is 40.000" > /dev/null
	grep "id=9" results/log.txt | grep "at 3600.000 pos is 80.000" > /dev/null
	grep "id=10" results/log.txt | grep "at 3600.000 pos is 120.000" > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json 50

random-waypoint: random-waypoint.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "id=6" results/log.txt | grep "at 3600.000 pos is (" > /dev/null
	grep "id=7" results/log.txt | grep "at 3600.000 pos is (" > /dev/null
	grep "id=8" results/log.txt | grep "at 3600.000 pos is (" > /dev/null
	grep "id=9" results/log.txt | grep "at 3600.000 pos is (" > /dev/null
	grep "id=10" results/log.txt | grep "at 3600.000 pos is (" > /dev/null
	$(NODE) --harmony --experimental-modules  ../check_pdr.mjs results/stats.json 50

clean:
	rm -rf results
