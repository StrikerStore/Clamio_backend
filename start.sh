#!/bin/bash

# Clamio Backend Startup Script

echo "🚀 Starting Clamio Backend Setup..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js v16 or higher."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo "❌ Node.js version 16 or higher is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo "❌ package.json not found. Please run this script from the backend directory."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file from template..."
    cp env.example .env
    echo "⚠️ Please edit .env file with your configuration before starting the server."
    echo "   Key settings to configure:"
    echo "   - JWT_SECRET: Change to a secure random string"
    echo "   - SHIPWAY_API_KEY: Your Shipway API key (optional for testing)"
    echo "   - CORS_ORIGIN: Your frontend URL"
    echo ""
    echo "Press Enter to continue or Ctrl+C to edit .env first..."
    read
fi

# Create data directory if it doesn't exist
if [ ! -d "data" ]; then
    echo "📁 Creating data directory..."
    mkdir -p data
fi

# Start the server
echo "🚀 Starting the server..."
echo "📊 Server will be available at: http://localhost:5000"
echo "🔗 Health check: http://localhost:5000/health"
echo "📚 API docs: http://localhost:5000/api"
echo ""
echo "👤 Default superadmin credentials:"
echo "   Email: superadmin@example.com"
echo "   Password: password123"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

npm run dev 