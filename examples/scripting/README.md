This example demonstrates **scripting integration** with TSCH-Sim.

It does that by demonstrating how to force RPL parent switch during a simulation run.

The network in the example has diamond-shape topology:

      root
      /   \
     A     B
      \   /
        C

Initially, the node C joins to the RPL network with one of the nodes A and B as its parent.
Once the join has happened, the script that controls the simulation disables the link
between the node C and its parent node, forcing it to use the other node as its parent.
This setup is useful for experiments such as the measurement of RPL parent switch speed and
its impact on the network performance.
