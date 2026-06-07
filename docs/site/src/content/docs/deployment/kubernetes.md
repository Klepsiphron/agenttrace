---
title: Kubernetes
description: Deploy AgentTrace on Kubernetes with PersistentVolumes.
---

Deploy AgentTrace as a simple Deployment + Service. No StatefulSet needed since storage is a single SQLite file — mount a PersistentVolumeClaim.

## Deployment Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agenttrace
  labels:
    app: agenttrace
spec:
  replicas: 1
  selector:
    matchLabels:
      app: agenttrace
  template:
    metadata:
      labels:
        app: agenttrace
    spec:
      containers:
        - name: agenttrace
          image: agenttrace:latest
          ports:
            - containerPort: 4317
          env:
            - name: NODE_ENV
              value: production
            - name: AGENTTRACE_DB_PATH
              value: /app/data/agenttrace.db
          volumeMounts:
            - name: data
              mountPath: /app/data
          livenessProbe:
            httpGet:
              path: /api/health
              port: 4317
            initialDelaySeconds: 10
            periodSeconds: 30
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /api/health
              port: 4317
            initialDelaySeconds: 5
            periodSeconds: 10
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: agenttrace-data
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: agenttrace-data
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
---
apiVersion: v1
kind: Service
metadata:
  name: agenttrace
spec:
  selector:
    app: agenttrace
  ports:
    - port: 80
      targetPort: 4317
```

## Important: Single Replica

Set `replicas: 1`. SQLite does not support concurrent writers — do not scale this deployment horizontally without migrating to PostgreSQL.

For high availability, use a single replica with a liveness probe and let Kubernetes restart the pod on failure.

## Ingress

Add an Ingress for external access:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: agenttrace
spec:
  rules:
    - host: agenttrace.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: agenttrace
                port:
                  number: 80
  tls:
    - hosts:
        - agenttrace.example.com
      secretName: agenttrace-tls
```

## Network Policy

Restrict access to trusted namespaces:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: agenttrace
spec:
  podSelector:
    matchLabels:
      app: agenttrace
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              access: trusted
  policyTypes:
    - Ingress
```

## Resource Limits

```yaml
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 512Mi
```
