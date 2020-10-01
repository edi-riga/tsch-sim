This example demonstrates a **line** topology.

There is only one type of node. Each non-root node generates traffic, forwards traffic, and is connected to its one or two neighbor nodes.

The file `config.json` has node positions automatically generated, as configured by this line:
 * "POSITIONING_LAYOUT": "Line".

The file `config-manual.json` has node connections manually set up. It uses a radio connectivity model fixed in the configuration (from here comes the term "fixed" links).