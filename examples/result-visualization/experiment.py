#!/usr/bin/python3

import os
import math
import pylab as pl
#import seaborn as sns
import json
import subprocess

if os.name == "nt":
    SIMULATOR = "..\\..\\tsch-sim-windows.bat"
else:
    SIMULATOR = "../../tsch-sim.sh"

CONFIG_TEMPLATE_NAME = "config.json.tmpl"

DEFAULT_OPTIONS = {
    "RESULTS_DIR": "results",
    "SCHEDULING_ALGORITHM": "Orchestra",
    "TSCH_SCHEDULE_CONF_DEFAULT_LENGTH": 7,
    "ORCHESTRA_UNICAST_PERIOD": 7,
    "ORCHESTRA_RULES": """[
        "orchestra_rule_eb_per_time_source",
        "orchestra_rule_unicast_per_neighbor_rpl_storing",
        "orchestra_rule_default_common"
    ]""",
    "ORCHESTRA_UNICAST_SENDER_BASED": 0,
}

class Experiment:
    def __init__(self, name, options):
        self.name = name
        self.results_dir = "./results-" + name
        self.options = dict(DEFAULT_OPTIONS)
        for key in options:
            self.options[key] = options[key]
        self.options["RESULTS_DIR"] = self.results_dir
        self.results = None

    def run(self):
        filename = generate_config_file(self.name, self.options)
        subprocess.call(" ".join([SIMULATOR, filename]), shell=True, stdout=subprocess.DEVNULL)

    def load_results(self):
        with open(os.path.join(self.results_dir, "stats_merged.json"), "r") as f:
            self.results = json.load(f)

def generate_config_file(name, options):
    with open(CONFIG_TEMPLATE_NAME, "r") as f:
        contents = f.read()
        for key in options:
            value = options[key]
            if type(value) is str and '\n' not in value:
                value = '"{}"'.format(value)
            else:
                value = str(value)
            contents = contents.replace("%{}%".format(key), value)
        filename = "config-{}.json".format(name)
        with open(filename, "w") as wf:
            wf.write(contents)
        return filename

# extract a single metric
def extract_metric(experiments, arguments):
    metric_name, default_value = arguments
    results = []
    for exp in experiments:
        exp_results = []
        for run in exp.results:
            run_results = exp.results[run]
            total = 0
            num_nodes = 0
            for node in run_results:
                # ignore the global summary information and gateway results
                if node in ["global-stats", "1"]:
                    continue
                value = run_results[node][metric_name]
                if value is None:
                    value = default_value
                total += value
                num_nodes += 1
            # compute the average metric across all nodes
            avg = total / num_nodes
            exp_results.append(avg)
        results.append(exp_results)
    return results

# extract multiple metrics and interpret them using the function passed in the arguments
def extract_metrics(experiments, arguments):
    # unpack the arguments
    metric1_name, metric2_name, function = arguments
    results = []
    for exp in experiments:
        exp_results1 = []
        exp_results2 = []
        for run in exp.results:
            run_results = exp.results[run]
            total1 = 0
            total2 = 0
            num_nodes = 0
            for node in run_results:
                # ignore the global summary information and the results on the root node
                if node in ["global-stats", "1"]:
                    continue
                total1 += run_results[node][metric1_name]
                total2 += run_results[node][metric2_name]
                num_nodes += 1
            # compute the average metric across all nodes
            avg1 = total1 / num_nodes
            avg2 = total2 / num_nodes
            exp_results1.append(avg1)
            exp_results2.append(avg2)

        results.append([function(x, y) for x, y in zip(exp_results1, exp_results2)])
    return results

def plot(experiments, function, arguments, title):
    pl.figure(figsize=(7, 4))
    pl.gca().xaxis.grid(False)
    pl.gca().yaxis.grid(True)

    results = function(experiments, arguments)

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
    pl.xticks(x, [exp.name for exp in experiments])

    pl.ylabel(title)
    # use 0 or `total_min_value` as the lower bound
    if "PDR" in title:
        pl.ylim(total_min_value, total_max_value)
    else:
        pl.ylim(0, total_max_value)

    pl.savefig("plot {}.pdf".format(title), format="pdf")
    pl.close()

def main():
    # construct experiments
    print("constructing experiments...")
    experiments = []
    experiments.append(Experiment("TSCH-min-3", {
        "SCHEDULING_ALGORITHM": "6tischMin",
        "TSCH_SCHEDULE_CONF_DEFAULT_LENGTH": 3}))
    experiments.append(Experiment("TSCH-min-5", {
        "SCHEDULING_ALGORITHM": "6tischMin",
        "TSCH_SCHEDULE_CONF_DEFAULT_LENGTH": 5}))
    experiments.append(Experiment("TSCH-RB-7", {
        "ORCHESTRA_UNICAST_PERIOD": 7,
        "ORCHESTRA_UNICAST_SENDER_BASED": 0}))
    experiments.append(Experiment("TSCH-SB-7", {
        "ORCHESTRA_UNICAST_PERIOD": 7,
        "ORCHESTRA_UNICAST_SENDER_BASED": 1}))
    experiments.append(Experiment("TSCH-SB-47", {
        "ORCHESTRA_UNICAST_PERIOD": 47,
        "ORCHESTRA_UNICAST_SENDER_BASED": 1}))

    # run the experiments
    print("running experiments...")
    for exp in experiments:
        print("   {}...".format(exp.name))
        exp.run()

    # load the experiment results
    print("loading experiment results...")
    for exp in experiments:
        exp.load_results()

    # plot various metrics from the experiments
    print("plotting experiment results...")

    #sns.set() # use seaborn default style
    #sns.set_style("whitegrid") # alternative style selection

    plot(experiments, extract_metric, ["tsch_join_time_sec", 3600], "TSCH joining time, seconds")
    plot(experiments, extract_metric, ["avg_current_joined_uA", 0], "Average current consumption, uA")
    plot(experiments, extract_metric, ["radio_duty_cycle_joined", 0], "Radio duty cycle, %")
    plot(experiments, extract_metrics, ["app_num_lost", "app_num_endpoint_rx", lambda x, y: 100.0 * (1.0 - x / (x + y))], "Application PDR, %")
    plot(experiments, extract_metrics, ["mac_parent_acked", "mac_parent_tx_unicast", lambda x, y: 100.0 * x / y], "Link layer PAR, %")

if __name__ == "__main__":
    main()
