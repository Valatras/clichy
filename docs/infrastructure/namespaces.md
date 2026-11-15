# Namespaces and service traffic

## Namespaces

```mermaid
flowchart TB
  Public[Browser: valtask.xyz / www.valtask.xyz] --> CF[Cloudflare reverse proxy]
  CF --> Tunnel[cloudflared Tunnel]
  subgraph Cluster[K3s cluster]
    subgraph Dev[clichy-dev]
      D[web + server + worker + CNPG primary + standby + Redis]
    end
    subgraph Test[clichy-test]
      T[web + server + worker + CNPG primary + standby + Redis + HPA]
    end
    subgraph Prod[clichy-prod]
      P[web + server + worker + CNPG primary + standby + Redis]
    end
    subgraph Monitoring[monitoring]
      M[Prometheus + Grafana + Alertmanager]
    end
    subgraph Headlamp[headlamp]
      H[Headlamp UI]
    end
    Traefik[Cluster Traefik]
  end
  Tunnel -->|HTTP to Traefik web :80; www canonicalized by Cloudflare| Traefik
  Traefik -->|host rules| Dev
  Traefik -->|host rules| Test
  Traefik -->|valtask.xyz| Prod
  M -. scrapes app and database metrics .-> Dev
  M -. scrapes app and database metrics .-> Test
  M -. scrapes app and database metrics .-> Prod
```

Each `clichy-*` namespace contains independent workload Services, database, Redis, generated ConfigMaps, and environment Secrets. There is no data replication between namespaces. Monitoring ServiceMonitor/PodMonitor resources select all three environments; actual production metric visibility still depends on successful installation and scrape health.

Production's public route is proxied by Cloudflare for `valtask.xyz` and `www.valtask.xyz`, then enters through the Cloudflare Tunnel to Traefik; `www.valtask.xyz` redirects at Cloudflare to canonical `valtask.xyz`. The tunnel and redirect are external configuration and are not represented as Kubernetes resources in this repository.

`headlamp` has separate RBAC and Ingress manifests. The Monitoring/Headlamp manifests and scripts configure cluster tools; inspect their LAN hostnames and access policy before exposing them.

## Setup and inspection

```bash
infra/kubernetes/scripts/prepare-namespace.sh test
kubectl get all,pvc,ingress -n clichy-test
kubectl get secret -n clichy-test
```

Secret listing shows names only. Do not print Secret data into logs or paste it into documentation. The setup script asks for database and GHCR credentials and stores a local protected env file under `$HOME/.config/clichy`.
