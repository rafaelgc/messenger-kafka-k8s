#!/usr/bin/env bash
# Print pods grouped by node, annotated with each node's AZ and capacity type.
set -euo pipefail

kubectl get nodes -L topology.kubernetes.io/zone,eks.amazonaws.com/capacityType --no-headers \
  | awk '{print $1"\t"$6"\t"$7}' > /tmp/node-meta.tsv

{
  for ns in default mongodb-operator; do
    kubectl get pods -n "$ns" -o jsonpath='{range .items[*]}{.spec.nodeName}{"\t"}{.metadata.namespace}{"\t"}{.metadata.name}{"\n"}{end}'
  done
} | sort | awk -F'\t' '
BEGIN {
  while ((getline < "/tmp/node-meta.tsv") > 0) {
    zone[$1] = $2
    cap[$1] = $3
  }
}
$1 != node {
  if (node != "") print ""
  print "=== " $1 " (" zone[$1] ", " cap[$1] ") ==="
  node = $1
}
{ print "  " $2 "/" $3 }
'
