This example demonstrates how to configure the simulator to execute **multiple runs**.

The base for this example is the "mesh" example in the parent directory.

Each run gets a different random seed, so their results are not identical. More precisely,
if the configured random seed is `N`, then the first run gets `N` as its random seed, the second `N+1` etc.

Runs are executed in parallel and can fully benefit from multiple CPU cores for speedup.

Each run creates its own log and stats file. The summary results of the runs are saved in the file "stats_merged.json".
