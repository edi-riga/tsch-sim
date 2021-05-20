all: tests clean

tests:
	make -C applications
	make -C generation
	make -C link_model
	make -C mobility
	make -C tsch
	make -C scheduling
	make -C routing
	make -C ip
	make -C stats

clean:
	make -C applications clean
	make -C generation clean
	make -C routing clean
	make -C link_model clean
	make -C mobility clean
	make -C scheduling clean
	make -C tsch clean
	make -C ip clean
	make -C stats clean
