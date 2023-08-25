#!/usr/bin/python3

import os
import math
import pylab as pl
import json
import subprocess

# -- config settings for the static links (1.0 is perfect link, 0.0 is no link)
TTP_TO_GATEWAY_LINK_QUALITY = 0.9
DEFAULT_RSSI = -80

SIM_DURATION_SEC = 3600
# -- 

if os.name == "nt":
    SIMULATOR = "..\\..\\tsch-sim-windows.bat"
else:
    SIMULATOR = "../../tsch-sim.sh"

CONFIG_TEMPLATE_NAME = "mobile-config.json.tmpl"

DEFAULT_OPTIONS = {
    "NUM_ROUTER_NODES": 1,
    "NUM_STATIC_LEAF_NODES": 1,
    "NUM_MOBILE_LEAF_NODES": 1,
    "RANGE_X" : 100,
    "RANGE_Y" : 100,
    "CONNECTIONS": [],
    "SIMULATION_DURATION_SEC": SIM_DURATION_SEC,
}

def get_num_mobile_per_cluster(num_total):
    num_static = num_total * 2 // 3
    num_mobile = num_total - num_static
    return num_mobile, num_static


class Experiment:
    def __init__(self, num_clusters, num_per_cluster, options={}):
        self.name = f"{num_clusters}_clusters_{num_per_cluster}_nodes_mobile"
        self.results_dir = "./results-" + self.name
        self.options = {}
        self.options["RESULTS_DIR"] = self.results_dir
        for key in DEFAULT_OPTIONS:
            self.options[key] = DEFAULT_OPTIONS[key]
        for key in options:
            self.options[key] = options[key]
        self.options["NUM_ROUTER_NODES"] = str(1 + num_clusters)
        nm, ns = get_num_mobile_per_cluster(num_per_cluster)
        self.options["NUM_STATIC_LEAF_NODES"] = str(num_clusters * ns)
        self.options["NUM_MOBILE_LEAF_NODES"] = str(num_clusters * nm)
        self.options["CONNECTIONS"] = generate_connections(num_clusters, num_per_cluster)
        self.options["POSITIONS"] = generate_positions(num_clusters, num_per_cluster)
        self.results = None

    def run(self):
        filename = generate_config_file(self.name, self.options)
        subprocess.call(" ".join([SIMULATOR, filename]), shell=True,
                        stdout=subprocess.DEVNULL)

    def load_results(self):
        with open(os.path.join(self.results_dir, "stats_merged.json"), "r") as f:
            self.results = json.load(f)


def generate_connections(num_clusters, num_per_cluster):
    rssi = DEFAULT_RSSI
    connections = []

    # gateway and TTP links are constant
    for i in range(num_clusters):
        id = i + 2
        connection = f'"FROM_ID": 1, "TO_ID": {id}, "RSSI": {rssi}, "LINK_QUALITY": {TTP_TO_GATEWAY_LINK_QUALITY}, "LINK_MODEL": "Fixed"'
        connections.append(connection)
        connection = f'"FROM_ID": {id}, "TO_ID": 1, "RSSI": {rssi}, "LINK_QUALITY": {TTP_TO_GATEWAY_LINK_QUALITY}, "LINK_MODEL": "Fixed"'
        connections.append(connection)

    # other links depend on the distance
    connections.append('"NODE_TYPE": "mobile_leaf_nodes", "LINK_MODEL": "UDGM"')
    connections.append('"NODE_TYPE": "static_leaf_nodes", "LINK_MODEL": "UDGM"')

    connections.append('"FROM_NODE_TYPE": "static_leaf_nodes", "TO_NODE_TYPE": "router_nodes", "LINK_MODEL": "UDGM"')
    connections.append('"FROM_NODE_TYPE": "router_nodes", "TO_NODE_TYPE": "static_leaf_nodes", "LINK_MODEL": "UDGM"')

    connections.append('"FROM_NODE_TYPE": "mobile_leaf_nodes", "TO_NODE_TYPE": "router_nodes", "LINK_MODEL": "UDGM"')
    connections.append('"FROM_NODE_TYPE": "router_nodes", "TO_NODE_TYPE": "mobile_leaf_nodes", "LINK_MODEL": "UDGM"')

    connections.append('"FROM_NODE_TYPE": "mobile_leaf_nodes", "TO_NODE_TYPE": "static_leaf_nodes", "LINK_MODEL": "UDGM"')
    connections.append('"FROM_NODE_TYPE": "static_leaf_nodes", "TO_NODE_TYPE": "mobile_leaf_nodes", "LINK_MODEL": "UDGM"')

    return "[{" + "},\n    {".join(connections) + "}]\n"


def generate_positions(num_clusters, num_per_cluster):
    positions = []

    next_id = 1
        
    # gateway
    position = f'"ID": {next_id}, "X": 0, "Y": 0'
    next_id += 1
    positions.append(position)

    # TTP
    for i in range(num_clusters):
        x = 500 * math.cos(2 * math.pi * (i + 1) / num_clusters)
        y = 500 * math.sin(2 * math.pi * (i + 1) / num_clusters)
        position =  f'"ID": {next_id}, "X": {round(x)}, "Y": {round(y)}'
        next_id += 1
        positions.append(position)

    # clusters
    nm, ns = get_num_mobile_per_cluster(num_per_cluster)

    # static nodes
    for i in range(num_clusters):
        cluster_x = 500 * math.cos(2 * math.pi * (i + 1) / num_clusters)
        cluster_y = 500 * math.sin(2 * math.pi * (i + 1) / num_clusters)

        for j in range(ns):
            x = 40 * math.cos(2 * math.pi * (j + 1) / ns)
            y = 40 * math.sin(2 * math.pi * (j + 1) / ns)
            position =  f'"ID": {next_id}, "X": {round(x + cluster_x)}, "Y": {round(y + cluster_y)}'
            next_id += 1
            positions.append(position)

    # mobile nodes
    for i in range(num_clusters):
        cluster_x = 500 * math.cos(2 * math.pi * (i + 1) / num_clusters)
        cluster_y = 500 * math.sin(2 * math.pi * (i + 1) / num_clusters)

        for j in range(nm):
            position =  f'"ID": {next_id}, "X": {round(cluster_x)}, "Y": {round(cluster_y)}'
            next_id += 1
            positions.append(position)

    return "[{" + "},\n    {".join(positions) + "}]\n"

    
def generate_config_file(name, options):
    with open(CONFIG_TEMPLATE_NAME, "r") as f:
        contents = f.read()
        for key in options:
            value = options[key]
            if type(value) is str and '\n' not in value:
                value = '"{}"'.format(value)
            else:
                value = str(value)
                if value in ["True", "False"]:
                    value = value.lower()
            contents = contents.replace("%{}%".format(key), value)
        filename = "config-{}.json".format(name)
        with open(filename, "w") as wf:
            wf.write(contents)
        return filename


def mean(series):
    if len(series) == 0: return 0.0
    return sum(series) / len(series)


# extract a single metric
def extract_metric(experiments, arguments, aggregate_function=mean):
    #print("aggregate_function=", aggregate_function)

    metric_name, default_value = arguments
    results = []
    for exp in experiments:
        exp_results = []
        for run in exp.results:
            if run == "aggregate-stats":
                continue
            run_results = exp.results[run]
            usable_run_results = []
            for node in run_results:
                # ignore the global summary information and gateway results
                if node in ["global-stats", "1"]:
                    continue
                value = run_results[node][metric_name]
                if value is None:
                    value = default_value
                usable_run_results.append(value)
            # compute the average metric across all nodes
            print(usable_run_results)
            exp_results.append(aggregate_function(usable_run_results))
        results.append(exp_results)
    return results


# extract multiple metrics and interpret them using the function passed in the arguments
def extract_metrics(experiments, arguments, aggregate_function=mean):
    # unpack the arguments
    metric1_name, metric2_name, function = arguments
    results = []
    for exp in experiments:
        exp_results1 = []
        exp_results2 = []
        for run in exp.results:
            if run == "aggregate-stats":
                continue
            run_results = exp.results[run]
            usable_run_results1 = []
            usable_run_results2 = []
            for node in run_results:
                # ignore the global summary information and the results on the root node
                if node in ["global-stats", "1"]:
                    continue
                usable_run_results1.append(run_results[node][metric1_name])
                usable_run_results2.append(run_results[node][metric2_name])
            # compute the average metric across all nodes
            exp_results1.append(aggregate_function(usable_run_results1))
            exp_results2.append(aggregate_function(usable_run_results2))

        results.append([function(x, y) for x, y in zip(exp_results1, exp_results2)])
    return results


def plot(title, experiments, function, arguments, aggregate_function=mean):
    pl.figure(figsize=(7, 4))
    pl.gca().xaxis.grid(False)
    pl.gca().yaxis.grid(True)

    results = function(experiments, arguments, aggregate_function)

    mean_values = []
    min_values = []
    max_values = []
    for result in results:
        mean_values.append(sum(result) / len(result))
        min_values.append(min(result))
        max_values.append(max(result))

    total_min_value = math.floor(min(min_values)) - 1
    total_max_value = math.ceil(max(max_values)) + 1

    x = range(len(results))
    min_values_yerr = [mean - mn for mean, mn in zip(mean_values, min_values)]
    max_values_yerr = [mx - mean for mean, mx in zip(mean_values, max_values)]
    bars = pl.bar(x, mean_values, yerr=[min_values_yerr, max_values_yerr])
    for b in bars:
        b.set_edgecolor("black")
        b.set_linewidth(1)
    pl.xticks(x, [exp.name for exp in experiments], rotation=90)

    pl.ylabel(title)
    # use 0 or `total_min_value` as the lower bound
    if "PDR" in title:
        pl.ylim(total_min_value, total_max_value)
    else:
        pl.ylim(0, total_max_value)

    pl.savefig("plot {}.pdf".format(title), format="pdf", bbox_inches="tight")
    pl.close()


def main():
    # construct experiments
    print("constructing experiments...")
    experiments = []

    # 3 clusters
    experiments.append(Experiment(3, 1))
    experiments.append(Experiment(3, 3))
    experiments.append(Experiment(3, 10))

    # 5 clusters
    experiments.append(Experiment(5, 1))
    experiments.append(Experiment(5, 3))
    experiments.append(Experiment(5, 10))


    # run the experiments
    print("running experiments...")
    for exp in experiments:
        print("   {}...".format(exp.name))
        exp.run()


if __name__ == "__main__":
    main()
