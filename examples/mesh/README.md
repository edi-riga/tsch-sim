This example demonstrates a **mesh** topology.

It uses the LogisticLoss distance based radio connectivity model. There is only one type of node.

Each node generates traffic, is connected to its geometrically closest nodes, and is capable of forwarding data.

The file `config.json` has node positions automatically generated, as configured by these values:
 * "POSITIONING_LAYOUT": "Mesh",
 * "POSITIONING_LINK_QUALITY": 0.8,
 * "POSITIONING_NUM_DEGREES": 6.

The file `config-manual.json` has node positions manually set up (based on the out of a generation script).

The file `config-of0.json` has automated positioning, but uses RPL OF0 objective function.