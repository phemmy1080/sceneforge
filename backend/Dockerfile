FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create renders directory
RUN mkdir -p /app/renders

EXPOSE 8080

# Default command — overridden by railway.toml startCommand for each service
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
