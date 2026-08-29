import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";
import { Express } from "express";

const swaggerDefinition = {
  openapi: "3.0.3",
  info: {
    title: "MyBrainBud API",
    version: "1.0.0",
    description:
      "REST API for MyBrainBud - AI-Powered Nigerian Exam Preparation Platform",
    contact: {
      name: "MyBrainBud Support",
    },
  },
  servers: [
    {
      url: "http://localhost:5000",
      description: "Development server",
    },
    {
      url: "https://api.mybrainbud.com",
      description: "Production server",
    },
  ],
  tags: [
    {
      name: "Health",
      description: "Health check endpoints",
    },
    {
      name: "Auth",
      description: "Authentication and session management",
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT access token obtained from login or registration",
      },
    },
    schemas: {
      UserProfile: {
        type: "object",
        properties: {
          id: {
            type: "string",
            format: "uuid",
            example: "550e8400-e29b-41d4-a716-446655440000",
          },
          firstName: { type: "string", example: "John" },
          lastName: { type: "string", nullable: true, example: "Doe" },
          email: {
            type: "string",
            format: "email",
            example: "john.doe@example.com",
          },
          role: {
            type: "string",
            enum: ["STUDENT", "PARENT", "TEACHER", "SCHOOL_ADMIN", "ADMIN"],
          },
          isVerified: {
            type: "boolean",
            description: "Whether the user's email has been verified",
          },
          isActive: { type: "boolean" },
        },
      },
      Error: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          message: { type: "string", example: "Invalid email or password" },
          errors: {
            type: "array",
            nullable: true,
            items: {
              type: "object",
              properties: {
                field: { type: "string", example: "email" },
                message: { type: "string", example: "Invalid email address" },
              },
            },
          },
        },
      },
    },
  },
  security: [
    {
      bearerAuth: [],
    },
  ],
};

export function setupSwagger(app: Express): void {
  const specs = swaggerJsdoc({
    definition: swaggerDefinition,
    apis: [],
  });

  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(specs, {
      customCss: ".swagger-ui .topbar { display: none }",
      customSiteTitle: "MyBrainBud API Documentation",
    })
  );

  console.log("[Swagger] API documentation available at /api-docs");
}
