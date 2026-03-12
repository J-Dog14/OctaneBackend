# Prisma Setup Guide for UAIS

This guide will help you set up Prisma for managing your database schemas.

## What is Prisma?

Prisma is a modern database toolkit that provides:
- **Schema Definition**: Declarative schema files (`.prisma`)
- **Type Safety**: Auto-generated TypeScript/JavaScript clients
- **Migrations**: Version-controlled database changes
- **Database Introspection**: Generate schemas from existing databases
- **Prisma Studio**: Visual database browser

## Initial Setup

### 1. Install Node.js and npm

If you don't have Node.js installed:
- Download from [nodejs.org](https://nodejs.org/)
- Or use a package manager: `choco install nodejs` (Windows)

Verify installation:
```bash
node --version
npm --version
```

### 2. Install Dependencies

```bash
npm install
```

This installs:
- `prisma` - CLI tool for schema management
- `@prisma/client` - Type-safe database client

### 3. Set Up Environment Variables

Create a `.env` file in the project root:

```bash
# Copy the example file
cp .env.example .env
```

Edit `.env` with your database credentials:

```env
WAREHOUSE_DATABASE_URL="postgresql://postgres:Byoung15!@localhost:5432/uais_warehouse?schema=public"
APP_DATABASE_URL="postgresql://postgres:Byoung15!@localhost:5432/local?schema=public"
```

### 4. Generate Prisma Clients

```bash
# Generate warehouse client
npm run prisma:warehouse:generate

# Generate app client
npm run prisma:app:generate
```

This creates type-safe clients in `prisma/generated/`.

## Using Prisma

### View Your Database (Prisma Studio)

```bash
# Open warehouse database in browser
npm run prisma:warehouse:studio

# Open app database in browser
npm run prisma:app:studio
```

Prisma Studio opens at `http://localhost:5555` - a visual interface to browse and edit your data.

### Create Migrations

When you modify a schema file, create a migration:

```bash
# Warehouse database
npm run prisma:warehouse:migrate

# App database
npm run prisma:app:migrate
```

This will:
1. Create a migration file in `prisma/warehouse/migrations/`
2. Apply the migration to your database
3. Regenerate the Prisma Client

### Apply Migrations (Production)

```bash
npm run prisma:migrate:deploy
```

### Format and Validate Schemas

```bash
# Format schema files (auto-fix formatting)
npm run prisma:format

# Validate schemas (check for errors)
npm run prisma:validate
```

## Schema Files

### Warehouse Schema (`prisma/warehouse/schema.prisma`)

Defines:
- **Dimension Tables**: `DAthletes` (analytics.d_athletes)
- **Fact Tables**: All `f_*` tables (athletic_screen, pro_sup, pitching, etc.)

### App Schema (`prisma/app/schema.prisma`)

Defines:
- **User Table**: Application user/athlete table

## Common Tasks

### Adding a New Column

1. Edit the schema file (e.g., `prisma/warehouse/schema.prisma`)
2. Add the field to the model:
   ```prisma
   model DAthletes {
     // ... existing fields
     newField String? @map("new_field") @db.Text
   }
   ```
3. Create migration:
   ```bash
   npm run prisma:warehouse:migrate
   ```
4. Name the migration (e.g., "add_new_field_to_athletes")

### Introspecting Existing Database

If you want to generate a Prisma schema from an existing database:

```bash
# Warehouse
npx prisma db pull --schema=prisma/warehouse/schema.prisma

# App
npx prisma db pull --schema=prisma/app/schema.prisma
```

**Note**: This will overwrite your schema file, so commit your changes first!

### Using Prisma Client in Code

```typescript
import { PrismaClient } from '../prisma/generated/warehouse'

const prisma = new PrismaClient()

// Query athletes
const athletes = await prisma.dAthletes.findMany({
  where: {
    normalizedName: 'RYAN WEISS'
  },
  include: {
    pitching: true  // Include related pitching data
  }
})

// Create athlete
const newAthlete = await prisma.dAthletes.create({
  data: {
    id: 'uuid-here',
    name: 'Ryan Weiss',
    normalizedName: 'RYAN WEISS',
    // ... other fields
  }
})
```

## Integration with Python/R

Prisma generates TypeScript/JavaScript clients. To use from Python or R:

1. **Option 1**: Use Prisma for schema management only, continue using Python/R for data access
2. **Option 2**: Create a Node.js API that uses Prisma, call it from Python/R
3. **Option 3**: Use Prisma migrations, but access data via existing Python/R libraries

## Benefits

1. **Single Source of Truth**: Schema files define your database structure
2. **Version Control**: Migrations track all database changes
3. **Type Safety**: Auto-generated types prevent errors
4. **Documentation**: Schema files serve as living documentation
5. **Visualization**: Prisma Studio provides a GUI for your data

## Next Steps

1. Run `npm install` to install dependencies
2. Set up `.env` with your database URLs
3. Run `npm run prisma:warehouse:generate` to generate clients
4. Open Prisma Studio to explore your data: `npm run prisma:warehouse:studio`
5. Start using Prisma for schema management!

