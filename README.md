# TSCH-Sim — a fast TSCH simulator

![CI](https://github.com/edi-riga/tsch-sim/workflows/CI/badge.svg)
[![Language grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/edi-riga/tsch-sim.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/edi-riga/tsch-sim/context:javascript)

TSCH-Sim is a TSCH simulator written in modern, modular JavaScript. It supports cross-platform execution using Node.js. Compared with existing alternatives such the OpenWSN 6TiSCH simulator and Cooja, TSCH-Sim has a much better performance, allowing to simulate networks with many thousands of nodes in real time. The simulator allows to use multiple radio propagation models, including models that have been theoretically or experimentally validated. It also includes support for mobile nodes.

![Web interface](https://atiselsts.github.io/resources/web-annotated.png)

## Features

### Protocol features

* IEEE 802.15.4 TSCH
* 6TiSCH minimal scheduler
* Orchestra scheduler
* RPL routing protocol with MRHOF and OF0 objective functions
* Leaf-and-forwarder scheduler and routing module for two-hop networks
* Multiple subslots inside the IEEE 802.15.4 TSCH slots

### Simulation infrastructure features

* Command line and web based interfaces: for automated execution and for interaction or demonstrations, respectively
* Network autogeneration for star, mesh, line and grid topologies
* Automated accounting of performance metrics: packet delivery ratio, latency, network join time, and others
* Compact simulation description files in JSON
* Charge consumption model, validated on Texas Instruments CC2650 hardware
* Random waypoint and line mobility models
* Unit Disk Graph, Logistic loss (from Cooja), Pister-hack model (from the 6TiSCH simulator), and other radio propagation models
* Trace-based simulations
* Simulation results exported to JSON files, format largely compatible with the 6TiSCH simulator output
* User control over the simulation from JavaScript code specified in configuration
* Easily configurable parallel execution of multiple simulation runs

### Examples and tests

* Demo with a star network: `examples/star`
* Demo with a mesh network: `examples/mesh`
* Demo with a line network: `examples/line`
* Demo with a grid network: `examples/grid`
* Demo with a two-hop hierarchical network: `examples/hierarchical`
* Demo with a large network with 1000 nodes: `examples/large-network`
* Demo that demonstrates parallelization of multiple simulation runs: `examples/multirun`
* Demo that demonstrates control of a simulation with a user-defined script: `examples/scripting`
* Demo that launches the web interface backend: `examples/web`
* Demo with comparative simulation runs and result visualization using matplotlib with Python: `examples/result-visualization`
* A number of regression tests for all main simulation features under `tests`

### Planned features

* Clock drift simulation
* 6top protocol
* 6tisch Minimal Scheduling Function (MSF)


## Documentation

[GitHub wiki](https://github.com/edi-riga/tsch-sim/wiki).

[Video tutorial](https://www.youtube.com/watch?v=7_mNrosDpD4).


## Installation

The simulator requires that Node.js is installed in the system. The minimal version supported Node.js version is 8.

The source code is self-contained, no NPM packages are required to run TSCH-Sim.

The simulator backend has been tested on Ubuntu Linux 20.04, Microsoft Windows 10, and Apple macOS 10.13.

To use the optional web interface, a modern web browser is required.


## Getting started

To execute the simulator on Linux or macOS:

    $ ./tsch-sim.sh <config_file>

On Windows:

    $ tsch-sim-windows.bat <config_file>

Assuming Node.js has been installed and the PATH environmental variable properly set up, it is also possible to start the simulator without using the command line. Simply drag-and-drop a config file onto the `tsch-sim-windows.bat` batch file.

To pass custom configuration to the simulator, put the configuration in a file, e.g. `config.json` and pass that file name as the command line argument. For example, to run the star network demo example (RPL+Orchestra), use `examples/star/config.json`.

To run the web interface on Linux or macOS:

    $ ./tsch-sim-web-interface.sh

On Windows (alternativiely, doubleclick on the batch file):

    $ tsch-sim-windows-web.bat

Running these scripts should open http://localhost:2020 in your web browser. The web interface has been tested in Mozilla Firefox, Microsoft Edge, Google Chrome, and Apple Safari.

## Repository structure

Directories:

* `source` — implementation of the simulator
* `web` — implementation of the web frontend
* `examples` — example simulation scenarios: configuration files along with their descriptions
* `tests` — regression tests
* `results` — is `SAVE_TO_FILE` is enabled in the configuration, logs and statistics from simulation runs are stored here

## Code origins

Some parts of the simulator are based on the TSCH and RPL implementations in the [Contiki-NG operating system](https://github.com/contiki-ng/contiki-ng), developed by Simon Duquennoy and others. The OpenWSN 6tisch simulator also has been an inspiration, particularly in terms of functionality.


## License

[3-Clause BSD](LICENSE).


## Referencing

A paper on the simulator is available at https://www.mdpi.com/1424-8220/20/19/5663

If you use this work in your scientific papers, please cite this article!

    @article{elsts2020tsch,
      title={{TSCH-Sim: Scaling Up Simulations of TSCH and 6TiSCH Networks}},
      author={Elsts, Atis},
      journal={Sensors},
      volume={20},
      number={19},
      pages={5663},
      year={2020},
      publisher={Multidisciplinary Digital Publishing Institute}
    }
