FROM python:3.12-slim
WORKDIR /app
COPY . .
# Render inyecta $PORT y $HOST; serve.py los lee y emite las cabeceras COOP/COEP
# que exige el wasm de Play! (pthreads -> SharedArrayBuffer).
CMD ["sh", "-c", "HOST=0.0.0.0 python3 serve.py"]
