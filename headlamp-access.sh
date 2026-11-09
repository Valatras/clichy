kubectl create token headlamp -n headlamp --duration=24h

# then on a terminal :
# kubectl port-forward -n headlamp svc/headlamp 4466:80   
