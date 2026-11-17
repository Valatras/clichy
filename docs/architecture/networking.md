# Networking and request flow

```mermaid
flowchart LR
  Client[Browser / external client] -->|HTTPS: valtask.xyz or www.valtask.xyz| Proxy[Cloudflare reverse proxy]
  Proxy -->|canonical valtask.xyz route| Tunnel[cloudflared tunnel]
  Tunnel -->|HTTP inside tunnel to Traefik port 80| Ingress[Traefik Ingress: entrypoint web]
  Proxy -. 301 www to canonical valtask.xyz .-> Client
  Ingress -->|/| WebSvc[ClusterIP clichy-web:80]
  Ingress -->|/api/auth, /photos| ApiSvc[ClusterIP clichy-server:3000]
  WebSvc --> WebPod[web Pod]
  ApiSvc --> ApiPod[server Pod]
  ApiPod -->|clichy-postgres-rw:5432| PG[CNPG primary Service]
  ApiPod -->|clichy-redis:6379| Redis[Redis Service]
  WorkerPod[worker Pod] --> PG
  WorkerPod --> Redis
  WorkerPod --> SharedPV[(photo PVC)]
  ApiPod --> SharedPV
```

The base Ingress uses Traefik class and the `web` entrypoint. It sends `/api/auth` and `/photos` to the API and `/` to web. Environment overlays change the hostname: `clichy.localhost` (Dev), `clichy-test.home.arpa` (Test), `valtask.xyz` (Production). In Production, Cloudflare acts as the public reverse proxy for both `valtask.xyz` and `www.valtask.xyz`; the configured Cloudflare Tunnel (`cloudflared`) carries requests to Traefik on port 80 before they reach the Kubernetes Services and Pods. Cloudflare terminates public HTTPS. The `www` hostname is redirected to the canonical `https://valtask.xyz` host at the proxy/tunnel edge; the Kubernetes Ingress handles the canonical host. Tunnel, DNS and redirect configuration are external to this repository. The repo's current base ingress annotation selects `web`; TLS configuration is not present in that Ingress.

This diagram shows Production. Test uses `clichy-citus-rw:5432` for API/worker database traffic, independently of its CNPG replication exercise.

Services use namespace-local DNS names (`clichy-postgres-rw`, `clichy-redis`, `clichy-server`, `clichy-web`). PostgreSQL and Redis are ClusterIP internal services; no public database/Redis ingress or service is configured. For local access, use the documented ingress route or explicit `kubectl port-forward` only when needed.

## Network diagram caveat

The separate Ingress resources for Grafana and Headlamp are under `infra/kubernetes/monitoring` and `infra/kubernetes/headlamp`; they are LAN-oriented configuration. They are not included in the application Ingress and are not exposed by the documented Cloudflare Tunnel. Check their host/entrypoint and cluster DNS before assuming reachability.
