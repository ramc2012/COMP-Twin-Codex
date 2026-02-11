FROM python:3.11-slim

WORKDIR /app

# Copy requirements if they exist, otherwise install manually
# We know requirements.txt exists in the source directory
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Expose Modbus port
EXPOSE 5020

# Run the simulator
CMD ["python", "main.py", "--host", "0.0.0.0", "--port", "5020"]
