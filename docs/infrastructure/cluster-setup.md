# Cluster setup

## Scope and prerequisites

`infra/kubernetes/scripts/install-k3s.sh` targets Ubuntu Server 24.04, installs the K3s version declared by `K3S_VERSION` (default `v1.37.2+k3s1`), and retains K3s defaults including Traefik and local-path storage. It creates a user-owned kubeconfig (default `~/.kube/config-k3s`) with mode 0600. It does not configure firewall rules, SSH, a multi-node cluster, or cloud resources.

Other scripts install Helm, prepare namespaces/secrets, install monitoring, configure LAN access, and install Headlamp. Read each script and confirm the selected kube context before running it: several scripts prompt before mutation, and namespace preparation for Production requires a mounted `/srv/clichy` filesystem.

## On-premise flow

1. Prepare an Ubuntu 24.04 host and verify storage/network prerequisites.
2. Run `infra/kubernetes/scripts/install-k3s.sh` as the non-root operator account.
3. Set `KUBECONFIG` to the generated kubeconfig and confirm `kubectl get nodes`.
4. Install Helm with `infra/kubernetes/scripts/install-helm.sh` if needed.
5. Prepare each namespace with `infra/kubernetes/scripts/prepare-namespace.sh dev|test|prod`; this creates local secret files and Kubernetes Secrets.
6. Install monitoring with `infra/kubernetes/scripts/install-monitoring.sh`.
7. Deploy application through CI or the exact SHA deploy script; details are in [deployment](../operations/deployment.md).

The scripts are operational instructions, not proof that a clean host bootstrap was recently exercised. Production local PV manifests require node `valtask` and paths under `/srv/clichy/k3s-storage/prod`; generic cloud/local clusters do not satisfy these assumptions.

## Local development cluster

The Dev overlay targets `clichy.localhost`, local/dev image tags, and one replica each. The repository does not provide a dedicated local cluster creation tool beyond K3s installer and the Dev Kustomize overlay. Build and load images into a chosen cluster yourself; this exact workflow is not automated in repository scripts.
