This example demonstrates running simulations with multiple different settings, and visualization of the results of these simulation.

The example uses Python's matplotlib for data visualization. Run `pip install -r requirements.txt` to get the dependencies.

The file `experiment.py` can be executed with Python. It runs multiple different simulations, loads the resulting `.json` files, and plots some metrics such as the node-to-root packet delivery rate for a packet collection application.

The configurations compared are taken from the original Orchestra paper:
- 6TiSCH minimal schedule, 3 slot slotframe
- 6TiSCH minimal schedule, 5 slot slotframe
- Orchestra schedule, 7 slot receiver-based unicast slotframe
- Orchestra schedule, 7 slot sender-based unicast slotframe
- Orchestra schedule, 47 slot sender-based unicast slotframe

The configurations are executed on a randomly generated mesh network with 100 nodes. Each configuration is executed four times, each run is 1 hour (3600 seconds) in the simulated time.

The script visualizes the average results of all four runs using a bar plot, and applies error bars to show the results of the best and the worst run.
