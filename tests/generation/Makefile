include ../Makefile.include

all: mesh grid star line

mesh: mesh.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "set position x=-445.05 y=-96.50" results/log.txt > /dev/null

grid: grid.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "set position x=1118.66 y=1118.66" results/log.txt > /dev/null

star: star.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "set position x=248.59 y=124.30" results/log.txt > /dev/null

line: line.json
	rm -rf results
	../../tsch-sim.sh $< > /dev/null
	grep "set position x=12305.27 y=0.00" results/log.txt > /dev/null

clean:
	rm -rf results
