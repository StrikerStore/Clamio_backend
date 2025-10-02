# Clamio Backend API

A Node.js backend API for the Clamio web application with user management, authentication, and Shipway API integration using Basic Authentication.

## Features

- 🔐 **Basic Authentication**: Secure email/password authentication with base64 encoding
- 👥 **User Management**: Superadmin can create, update, delete admin and vendor users
- 🏢 **Shipway Integration**: Warehouse validation and data fetching from Shipway API
- 📊 **Excel Database**: Local Excel file-based data storage
- 🔒 **Security**: Input validation, rate limiting, CORS, and security headers
- 📝 **Password Management**: Secure password hashing and reset functionality

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Authentication**: Basic Auth + bcryptjs
- **Database**: Excel files (xlsx)
- **Validation**: express-validator
- **Security**: helmet, cors, rate-limiting
- **HTTP Client**: axios

## Prerequisites

- Node.js (v16 or higher)
- npm or pnpm
- Shipway API key (for warehouse validation)

## Installation

1. **Clone the repository**
   ```bash
   cd backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   # or
   pnpm install
   ```

3. **Environment Setup**
   ```bash
   # Copy environment template
   cp env.example .env
   
   # Edit .env file with your configuration
   nano .env
   ```

4. **Environment Variables**
   ```env
   # Server Configuration
   PORT=5000
   NODE_ENV=development
   
   # Basic Authentication Configuration
   # Note: Basic Auth uses email:password encoded in base64
   # No JWT secret needed for Basic Auth
   
   # Database Configuration
   DB_FILE_PATH=./data/users.xlsx
   
   # Shipway API Configuration
   SHIPWAY_API_BASE_URL=https://app.shipway.com/api
   SHIPWAY_API_KEY=your-shipway-api-key
   
   # Security
   BCRYPT_ROUNDS=12
   RATE_LIMIT_WINDOW_MS=900000
   RATE_LIMIT_MAX_REQUESTS=100
   
   # CORS Configuration
   CORS_ORIGIN=http://localhost:3000
   ```

## Running the Application

### Development Mode
```bash
npm run dev
# or
pnpm dev
```

### Production Mode
```bash
npm start
# or
pnpm start
```

The server will start on `http://localhost:5000` (or the port specified in your .env file).

## API Endpoints

### Authentication

| Method | Endpoint | Description | Access |
|--------|----------|-------------|---------|
| POST | `/api/auth/login` | Login with email and password | Public |
| POST | `/api/auth/login/phone` | Login with phone and password | Public |
| POST | `/api/auth/logout` | Logout user | Private |
| GET | `/api/auth/profile` | Get current user profile | Private |
| PUT | `/api/auth/change-password` | Change user password | Private |
| GET | `/api/auth/verify` | Verify Basic Auth credentials | Private |
| POST | `/api/auth/generate-header` | Generate Basic Auth header | Public |

### User Management (Superadmin Only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/users` | Create new user (admin/vendor) |
| GET | `/api/users` | Get all users with pagination |
| GET | `/api/users/:id` | Get user by ID |
| PUT | `/api/users/:id` | Update user |
| DELETE | `/api/users/:id` | Delete user |
| GET | `/api/users/role/:role` | Get users by role |
| GET | `/api/users/status/:status` | Get users by status |
| PATCH | `/api/users/:id/toggle-status` | Toggle user status |

### Shipway Integration (Superadmin Only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/shipway/warehouse/:warehouseId` | Get warehouse details |
| GET | `/api/shipway/validate/:warehouseId` | Validate warehouse ID |
| GET | `/api/shipway/test-connection` | Test Shipway API connection |
| POST | `/api/shipway/validate-warehouse` | Validate warehouse for user creation |
| POST | `/api/shipway/multiple-warehouses` | Get multiple warehouses |
| GET | `/api/shipway/stats` | Get warehouse API statistics |

## Basic Authentication

### How Basic Auth Works

Basic Authentication uses the format: `Authorization: Basic <base64-encoded-credentials>`

Where credentials are: `email:password` encoded in base64.

### Login Request
```json
POST /api/auth/login
{
  "email": "user@example.com",
  "password": "password123"
}
```

### Login Response
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "user_123",
      "name": "John Doe",
      "email": "user@example.com",
      "role": "admin",
      "status": "active"
    },
    "authHeader": "Basic dXNlckBleGFtcGxlLmNvbTpwYXNzd29yZDEyMw==",
    "authType": "Basic"
  }
}
```

### Generate Basic Auth Header
```json
POST /api/auth/generate-header
{
  "email": "user@example.com",
  "password": "password123"
}
```

### Protected Routes
Include the Basic Auth header in all protected requests:
```
Authorization: Basic dXNlckBleGFtcGxlLmNvbTpwYXNzd29yZDEyMw==
```

## User Management Examples

### Create Admin User
```json
POST /api/users
Authorization: Basic <superadmin-credentials>

{
  "name": "John Admin",
  "email": "admin@example.com",
  "phone": "+1234567890",
  "password": "AdminPass123",
  "role": "admin",
  "contactNumber": "+1234567890"
}
```

### Create Vendor User
```json
POST /api/users
Authorization: Basic <superadmin-credentials>

{
  "name": "Jane Vendor",
  "email": "vendor@example.com",
  "phone": "+1234567890",
  "password": "VendorPass123",
  "role": "vendor",
  "warehouseId": "6430"
}
```

### Get All Users with Pagination
```
GET /api/users?page=1&limit=10&role=admin&status=active
Authorization: Basic <superadmin-credentials>
```

## Shipway Integration Examples

### Validate Warehouse
```json
POST /api/shipway/validate-warehouse
Authorization: Basic <superadmin-credentials>

{
  "warehouseId": "6430"
}
```

### Get Warehouse Details
```
GET /api/shipway/warehouse/6430
Authorization: Basic <superadmin-credentials>
```

## Default Users

The system comes with a default superadmin user:

- **Email**: `superadmin@example.com`
- **Password**: `password123`
- **Role**: `superadmin`

## Error Handling

The API returns consistent error responses:

```json
{
  "success": false,
  "message": "Error description",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format",
      "value": "invalid-email"
    }
  ]
}
```

## Security Features

- **Basic Authentication**: Secure email/password authentication
- **Password Hashing**: bcrypt with configurable salt rounds
- **Input Validation**: Comprehensive validation using express-validator
- **Rate Limiting**: Configurable rate limiting per IP
- **CORS Protection**: Configurable CORS settings
- **Security Headers**: Helmet.js for security headers
- **Role-based Access**: Fine-grained access control

## Database Structure

The Excel database stores user data with the following structure:

| Field | Type | Description |
|-------|------|-------------|
| id | String | Unique user identifier |
| name | String | User's full name |
| email | String | User's email address |
| phone | String | User's phone number |
| password | String | Hashed password |
| role | String | User role (admin/vendor/superadmin) |
| status | String | User status (active/inactive) |
| warehouseId | String | Warehouse ID (for vendors) |
| warehouseDetails | Object | Warehouse details from Shipway |
| contactNumber | String | Contact number (for admins) |
| createdAt | String | User creation timestamp |
| updatedAt | String | Last update timestamp |
| lastLogin | String | Last login timestamp |

## Development

### Project Structure
```
backend/
├── config/
│   └── database.js          # Excel database configuration
├── controllers/
│   ├── authController.js    # Authentication logic
│   ├── userController.js    # User management logic
│   └── shipwayController.js # Shipway API logic
├── middleware/
│   ├── auth.js             # Basic Auth middleware
│   └── validation.js       # Input validation middleware
├── routes/
│   ├── auth.js             # Authentication routes
│   ├── users.js            # User management routes
│   └── shipway.js          # Shipway API routes
├── services/
│   └── shipwayService.js   # Shipway API service
├── test/
│   └── test-api.js         # API testing script
├── data/                   # Excel database files
├── server.js               # Main server file
├── package.json            # Dependencies
├── env.example             # Environment template
├── start.sh                # Startup script
└── README.md               # Documentation
```

### Adding New Features

1. **Create Controller**: Add business logic in `controllers/`
2. **Create Routes**: Define API endpoints in `routes/`
3. **Add Validation**: Create validation rules in `middleware/validation.js`
4. **Update Database**: Extend database methods in `config/database.js`

## Testing

```bash
# Run tests
node test/test-api.js

# Or run with npm
npm test
```

## Deployment

1. **Set Environment Variables**: Configure production environment variables
2. **Install Dependencies**: `npm install --production`
3. **Start Server**: `npm start`
4. **Use Process Manager**: Consider using PM2 for production deployment

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For support and questions, please contact the development team or create an issue in the repository. 