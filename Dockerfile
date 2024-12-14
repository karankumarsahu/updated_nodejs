# Use an official Node.js image as the base
FROM node:18-slim

# Install WireGuard and networking tools
RUN apt-get update && apt-get install -y \
    wireguard \
    iproute2 \
    iptables \
    iputils-ping \
    curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

RUN npm run build

# Expose the port for the application (if applicable)
EXPOSE 8000

# Command to run the application
CMD ["npm", "run", "start"]
