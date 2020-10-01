This example demonstrates a **large network** with 1000 nodes. It has a simple hierarchical topology.

It uses a preconfigured link based radio connectivity model. There are three types of nodes:
1) Root node
2) Forwarder nodes
3) Leaf nodes

Each leaf node generates traffic.
Each forwarder is connected to the root node and to some leaf nodes, and forwards traffic.
Each leaf node is connected to one forwarder node.

Leaf-and-forwarder routing and scheduling options are used, as the Orchestra scheduler is not suitable for 1000+ node networks.
