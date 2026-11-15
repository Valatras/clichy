# Glossary

| Term | Meaning in this repository |
|---|---|
| API | Fastify service in `apps/server` |
| Derivative | Resized WebP preview stored beside photo data on shared filesystem |
| Outbox | PostgreSQL `PhotoProcessingOutbox` rows used to reliably publish work to Redis |
| pHash | Perceptual image hash generated from a 32×32 grayscale image using low-frequency DCT coefficients |
| Hamming distance | Number of differing bits between two 64-bit pHashes |
| Overlay | Kustomize environment-specific customization of base resources |
| PVC / PV | Kubernetes persistent volume claim / volume |
| SHA | Git commit SHA used as immutable image tag (`sha-<40 hex chars>`) |
