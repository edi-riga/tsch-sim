This example demonstrates a **star** topology.

There are two types of nodes:
1) Root node
2) Leaf nodes

The file `config.json` has node positions automatically generated, as configured by this line:
 * "POSITIONING_LAYOUT": "Star".
There are also connections between leaf nodes.

The file `config-manual.json` has node connections set up depending on node type. All leaf nodes are directly connected to the root nodes, but there are no connections between the leaf nodes. If simulation of interference between the leaf nodes is desired, then connections between them should be added.

