const swaggerJsdoc = require("swagger-jsdoc");

const port = Number(process.env.PORT || 4000);

const options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Money Trend API",
      version: "1.0.0",
      description:
        "Money Trend fintech backend — Auth, KYC, Profile, Market (FD/RD rates), Wallet (Razorpay), FD/RD portfolio, Admin.",
      contact: { name: "Money Trend" },
    },
    servers: [
      { url: `http://localhost:${port}/api`, description: "Local development" },
      { url: "/api", description: "Relative / proxied" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Paste accessToken from login/register",
        },
      },
      schemas: {
        SuccessResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string" },
            data: { type: "object" },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string" },
            error: { type: "string" },
          },
        },
        RegisterBody: {
          type: "object",
          required: ["full_name", "email", "password", "confirm_password", "phone", "date_of_birth"],
          properties: {
            full_name: { type: "string", example: "Rajesh Kumar" },
            email: { type: "string", example: "user@example.com" },
            password: { type: "string", example: "Secret@123" },
            confirm_password: { type: "string", example: "Secret@123" },
            phone: { type: "string", example: "9876543210" },
            date_of_birth: { type: "string", example: "1995-08-15", description: "YYYY-MM-DD or DD-MM-YYYY" },
            // otp: { type: "string", example: "123456", description: "Register OTP currently disabled" },
          },
        },
        LoginBody: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", example: "user@example.com" },
            password: { type: "string", example: "Secret@123" },
            // otp: { type: "string", example: "123456", description: "Login OTP currently disabled" },
          },
        },
        // Register/Login OTP schemas kept for when OTP is re-enabled
        SendRegisterOtpBody: {
          type: "object",
          required: ["phone"],
          properties: {
            phone: { type: "string", example: "9876543210" },
          },
        },
        SendLoginOtpBody: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", example: "user@example.com" },
            password: { type: "string", example: "Secret@123" },
          },
        },
        ForgotPasswordOtpBody: {
          type: "object",
          required: ["email", "phone", "date_of_birth"],
          properties: {
            email: { type: "string", example: "user@example.com" },
            phone: { type: "string", example: "9876543210" },
            date_of_birth: { type: "string", example: "1995-08-15" },
          },
        },
        ResetPasswordBody: {
          type: "object",
          required: ["email", "phone", "date_of_birth", "otp", "password", "confirm_password"],
          properties: {
            email: { type: "string", example: "user@example.com" },
            phone: { type: "string", example: "9876543210" },
            date_of_birth: { type: "string", example: "1995-08-15" },
            otp: { type: "string", example: "123456" },
            password: { type: "string", example: "NewSecret@123" },
            confirm_password: { type: "string", example: "NewSecret@123" },
          },
        },
        FdInvestBody: {
          type: "object",
          required: ["bank_name", "principal_amount", "interest_rate", "tenure_months", "start_date"],
          properties: {
            bank_name: { type: "string", example: "SBI" },
            bank_code: { type: "string", example: "sbi" },
            principal_amount: { type: "number", example: 100000 },
            interest_rate: { type: "number", example: 6.7 },
            tenure_months: { type: "integer", example: 12 },
            start_date: { type: "string", example: "2026-07-28" },
            compounding: { type: "string", example: "quarterly" },
          },
        },
        RdInvestBody: {
          type: "object",
          required: ["bank_name", "monthly_amount", "interest_rate", "tenure_months", "start_date"],
          properties: {
            bank_name: { type: "string", example: "HDFC" },
            monthly_amount: { type: "number", example: 5000 },
            interest_rate: { type: "number", example: 6.85 },
            tenure_months: { type: "integer", example: 36 },
            start_date: { type: "string", example: "2026-07-28" },
          },
        },
        BreakBody: {
          type: "object",
          properties: {
            interest_earned: { type: "number", example: 500, description: "Gain case" },
            loss_amount: { type: "number", example: 200, description: "Loss case" },
          },
        },
        DepositCreateBody: {
          type: "object",
          required: ["amount"],
          properties: {
            amount: { type: "number", example: 1000, description: "INR amount" },
          },
        },
        DepositVerifyBody: {
          type: "object",
          required: ["razorpay_order_id", "razorpay_payment_id", "razorpay_signature"],
          properties: {
            razorpay_order_id: { type: "string" },
            razorpay_payment_id: { type: "string" },
            razorpay_signature: { type: "string" },
          },
        },
        BankAccountBody: {
          type: "object",
          required: [
            "account_holder_name",
            "bank_name",
            "branch_name",
            "ifsc",
            "account_number",
          ],
          properties: {
            account_holder_name: { type: "string", example: "Rajesh Kumar" },
            bank_name: { type: "string", example: "State Bank of India" },
            branch_name: { type: "string", example: "Bhubaneswar" },
            ifsc: { type: "string", example: "SBIN0001234" },
            account_number: { type: "string", example: "123456789012" },
          },
        },
        WithdrawBody: {
          type: "object",
          required: ["amount"],
          properties: {
            amount: { type: "number", example: 500 },
          },
        },
        KycStatusBody: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["approved", "rejected"], example: "approved" },
            reason: { type: "string", example: "Documents not clear" },
          },
        },
        WithdrawalProcessBody: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["approved", "paid", "rejected"], example: "paid" },
            admin_note: { type: "string" },
          },
        },
        SupportTicketStatusBody: {
          type: "object",
          required: ["status"],
          properties: {
            status: {
              type: "string",
              enum: ["pending", "in_process", "fixed"],
              example: "in_process",
              description: "Pending | In Process | Fixed",
            },
            admin_note: { type: "string", example: "Looking into withdrawal delay" },
          },
        },
        CreditCheckRunBody: {
          type: "object",
          required: ["consent_given", "consent_version"],
          properties: {
            userId: { type: "integer", example: 1, description: "Defaults to JWT user" },
            bureau: {
              type: "string",
              enum: ["CIBIL", "EXPERIAN", "EQUIFAX", "CRIF"],
              example: "EXPERIAN",
            },
            consent: { type: "boolean", example: true },
            consent_given: { type: "boolean", example: true },
            consent_version: { type: "string", example: "v1.0-2026-09-01" },
          },
        },
        CreditCheckConsentBody: {
          type: "object",
          required: ["consent_version"],
          properties: {
            consent: { type: "boolean", example: true },
            consent_given: { type: "boolean", example: true },
            consent_version: { type: "string", example: "v1.0-2026-09-01" },
          },
        },
        FdRdRateBody: {
          type: "object",
          required: ["bankName", "productType", "interestRate", "tenure", "tenureUnit"],
          properties: {
            bankName: { type: "string", example: "ABC Bank" },
            bankCode: { type: "string", example: "abc" },
            productType: { type: "string", enum: ["FD", "RD"], example: "FD" },
            interestRate: { type: "number", example: 8.75 },
            tenure: { type: "integer", example: 5 },
            tenureUnit: { type: "string", enum: ["days", "months", "years"], example: "years" },
            minDeposit: { type: "number", example: 1000 },
            maxDeposit: { type: "number", example: 1000000 },
            customerCategory: {
              type: "string",
              enum: ["regular", "senior-citizen"],
              example: "regular",
            },
            effectiveDate: { type: "string", example: "2026-09-01" },
            expiryDate: { type: "string", example: "2027-09-01" },
            status: { type: "string", enum: ["active", "inactive"], example: "active" },
          },
        },
        RateStatusBody: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["active", "inactive"], example: "inactive" },
          },
        },
        ArticleBody: {
          type: "object",
          required: ["heading", "description"],
          properties: {
            heading: { type: "string", example: "How to choose the best FD in 2026" },
            description: { type: "string", example: "Full article or news content here..." },
            status: { type: "string", enum: ["draft", "published"], example: "published" },
            image: { type: "string", description: "Image URL if not uploading file" },
          },
        },
        BannerBody: {
          type: "object",
          required: ["title", "description"],
          properties: {
            title: { type: "string", example: "Invest smarter with Money Trend" },
            description: { type: "string", example: "Compare FD & RD rates across top banks" },
            image: { type: "string", description: "Image URL if not uploading file" },
          },
        },
      },
    },
    tags: [
      { name: "Health" },
      { name: "Home" },
      { name: "Articles" },
      { name: "Banners" },
      { name: "Auth" },
      { name: "KYC" },
      { name: "Profile" },
      { name: "Market" },
      { name: "FD" },
      { name: "RD" },
      { name: "Wallet" },
      { name: "Rates" },
      { name: "Credit Check" },
      { name: "Admin" },
    ],
    paths: {
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Health check",
          responses: { 200: { description: "OK" } },
        },
      },
      "/home": {
        get: {
          tags: ["Home"],
          summary: "Home page — featured products, ticker, compare FD/RD, services (public)",
          responses: { 200: { description: "Home payload" } },
        },
      },
      "/home/full": {
        get: {
          tags: ["Home"],
          summary: "Home page — optional Bearer token adds dashboard + compare user info",
          description: "Public. No JWT required. Send Authorization header to include logged-in snapshot.",
          responses: { 200: { description: "Full home payload" } },
        },
      },
      "/home/compare": {
        get: {
          tags: ["Home"],
          summary: "Compare & Invest — public; shows wallet/KYC/invest buttons when token sent",
          description: "No JWT required to fetch bank rates. With token, returns user.can_invest and per-bank Invest button state.",
          parameters: [
            { name: "type", in: "query", schema: { type: "string", enum: ["FD", "RD"], default: "FD" } },
            { name: "tenure", in: "query", schema: { type: "string", example: "1_year" } },
            { name: "amount", in: "query", schema: { type: "number", example: 100000 } },
            { name: "limit", in: "query", schema: { type: "integer", example: 4 } },
          ],
          responses: { 200: { description: "Ranked banks + optional user block" } },
        },
      },
      "/home/dashboard": {
        get: {
          tags: ["Home"],
          summary: "Financial snapshot — public route; data only when Bearer token sent",
          description: "No JWT required. Without token returns login_required. With token returns net worth graph.",
          responses: { 200: { description: "Dashboard or login prompt" } },
        },
      },
      "/articles/blogs": {
        get: {
          tags: ["Articles"],
          summary: "List published blogs (public, no login)",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", example: 20 } },
            { name: "offset", in: "query", schema: { type: "integer", example: 0 } },
          ],
          responses: { 200: { description: "Blog list with image, heading, description" } },
        },
      },
      "/articles/blogs/{id}": {
        get: {
          tags: ["Articles"],
          summary: "Get single blog by ID (public)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Blog detail" }, 404: { description: "Not found" } },
        },
      },
      "/articles/news": {
        get: {
          tags: ["Articles"],
          summary: "List published news (public, no login)",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", example: 20 } },
            { name: "offset", in: "query", schema: { type: "integer", example: 0 } },
          ],
          responses: { 200: { description: "News list" } },
        },
      },
      "/articles/news/{id}": {
        get: {
          tags: ["Articles"],
          summary: "Get single news by ID (public)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "News detail" }, 404: { description: "Not found" } },
        },
      },
      "/banners": {
        get: {
          tags: ["Banners"],
          summary: "List banners (public, no login)",
          description: "Use for home/app banner carousel or banner section.",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", example: 20 } },
            { name: "offset", in: "query", schema: { type: "integer", example: 0 } },
          ],
          responses: { 200: { description: "Banner list with title, description, image" } },
        },
      },
      "/banners/{id}": {
        get: {
          tags: ["Banners"],
          summary: "Get single banner by ID (public)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Banner detail" }, 404: { description: "Not found" } },
        },
      },
      // Register / Login OTP routes currently disabled
      // "/auth/register/send-otp": { ... },
      // "/auth/register/resend-otp": { ... },
      // "/auth/login/send-otp": { ... },
      // "/auth/login/resend-otp": { ... },
      "/auth/forgot-password/send-otp": {
        post: {
          tags: ["Auth"],
          summary: "Send forgot-password OTP via SMS",
          description:
            "Step 1 — verify email, phone and date of birth, then send OTP to registered mobile.",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ForgotPasswordOtpBody" } },
            },
          },
          responses: {
            200: { description: "OTP sent for password reset" },
            404: { description: "Account not found" },
            429: { description: "Rate limited or cooldown" },
          },
        },
      },
      "/auth/forgot-password/resend-otp": {
        post: {
          tags: ["Auth"],
          summary: "Resend forgot-password OTP via SMS",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ForgotPasswordOtpBody" } },
            },
          },
          responses: {
            200: { description: "OTP resent" },
            404: { description: "Account not found" },
            429: { description: "Rate limited or cooldown" },
          },
        },
      },
      "/auth/forgot-password/reset": {
        post: {
          tags: ["Auth"],
          summary: "Reset password with OTP",
          description:
            "Step 2 — submit email, phone, date of birth, OTP and new password.",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ResetPasswordBody" } },
            },
          },
          responses: {
            200: { description: "Password reset successful" },
            400: { description: "Invalid OTP or validation error" },
            404: { description: "Account not found" },
          },
        },
      },
      "/auth/register": {
        post: {
          tags: ["Auth"],
          summary: "User register (OTP disabled)",
          description: "Register with full name, email, password, phone and DOB. OTP not required.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/RegisterBody" } } },
          },
          responses: {
            201: { description: "Registered — next_step kyc" },
            400: { description: "Validation error" },
            409: { description: "Email/phone exists" },
          },
        },
      },
      "/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "User login (OTP disabled)",
          description: "Login with email and password. OTP not required.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/LoginBody" } } },
          },
          responses: {
            200: { description: "Login success + tokens" },
            401: { description: "Invalid credentials" },
          },
        },
      },
      "/kyc/pan-lookup": {
        post: {
          tags: ["KYC"],
          summary: "PAN lookup (returns full name)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { pan_number: { type: "string", example: "ABCDE1234F" } },
                },
              },
            },
          },
          responses: { 200: { description: "PAN details" } },
        },
      },
      "/kyc/manual": {
        post: {
          tags: ["KYC"],
          summary: "Submit manual KYC (multipart form-data)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["pan_number", "full_name", "aadhaar_number", "pan_image", "aadhaar_image"],
                  properties: {
                    pan_number: { type: "string" },
                    full_name: { type: "string" },
                    aadhaar_number: { type: "string" },
                    aadhaara_number: { type: "string", description: "Alias for aadhaar_number" },
                    pan_image: { type: "string", format: "binary" },
                    aadhaar_image: { type: "string", format: "binary" },
                    aadhaara_image: { type: "string", format: "binary" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "KYC submitted — next_step nominee" } },
        },
      },
      "/kyc/digilocker": {
        post: {
          tags: ["KYC"],
          summary: "Submit DigiLocker KYC",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    pan_number: { type: "string" },
                    full_name: { type: "string" },
                    aadhaar_number: { type: "string" },
                    digilocker_ref: { type: "string" },
                    pan_image: { type: "string", format: "binary" },
                    aadhaar_image: { type: "string", format: "binary" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "DigiLocker KYC submitted" } },
        },
      },
      "/kyc/nominee": {
        post: {
          tags: ["KYC"],
          summary: "Submit nominee (SEBI-compliant, multipart)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    nominee_name: { type: "string" },
                    relationship: { type: "string", example: "Brother" },
                    dob: { type: "string", example: "2001-05-10" },
                    mobile: { type: "string" },
                    email: { type: "string" },
                    pan_number: { type: "string" },
                    aadhaar_number: { type: "string" },
                    address: { type: "string" },
                    pan_image: { type: "string", format: "binary" },
                    aadhaar_image: { type: "string", format: "binary" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "Nominee saved" } },
        },
      },
      "/profile": {
        get: {
          tags: ["Profile"],
          summary: "Get user profile",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Profile" } },
        },
      },
      "/profile/portfolio": {
        get: {
          tags: ["Profile"],
          summary: "Smart Dashboard — portfolio + pie/bar charts",
          description:
            "Returns summary cards, portfolio_mix (pie), monthly_bar_chart (stacked bars), financial_health, investments list, recent_transactions, credit_score CTA, plus raw fd/rd arrays.",
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description:
                "Smart dashboard payload with summary, portfolio_mix, monthly_bar_chart, financial_health, investments, recent_transactions, credit_score, fd, rd",
            },
          },
        },
      },
      "/profile/bank-account": {
        get: {
          tags: ["Profile"],
          summary: "Get saved bank account (masked)",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Bank account" } },
        },
        put: {
          tags: ["Profile"],
          summary: "Save / update bank account for withdrawals",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/BankAccountBody" } },
            },
          },
          responses: { 200: { description: "Bank saved" } },
        },
      },
      "/profile/{id}": {
        put: {
          tags: ["Profile"],
          summary: "Edit profile by user id (not PAN/Aadhaar)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } },
          ],
          requestBody: {
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    full_name: { type: "string" },
                    email: { type: "string" },
                    phone: { type: "string" },
                    profile_image: { type: "string", format: "binary" },
                    nominee_name: { type: "string" },
                    relationship: { type: "string" },
                    dob: { type: "string" },
                    nominee_mobile: { type: "string" },
                    nominee_email: { type: "string" },
                    address: { type: "string" },
                  },
                },
              },
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    full_name: { type: "string" },
                    email: { type: "string" },
                    phone: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "Updated" }, 403: { description: "Wrong user id" } },
        },
      },
      "/market/banks/history/trend": {
        get: {
          tags: ["Market"],
          summary: "12-Month Interest Rate Trend for ALL banks (graph-ready)",
          description:
            "Returns FD/RD rate trend graph data for every bank. Default period is 1_year (12 months).",
          parameters: [
            {
              name: "period",
              in: "query",
              schema: {
                type: "string",
                enum: ["previous_month", "1_year", "3_years", "5_years", "10_years"],
                default: "1_year",
              },
            },
            { name: "tenure", in: "query", schema: { type: "string", example: "1_year" } },
            {
              name: "category",
              in: "query",
              schema: { type: "string", enum: ["regular", "senior-citizen"] },
            },
            { name: "type", in: "query", schema: { type: "string", enum: ["FD", "RD"] } },
            { name: "principal", in: "query", schema: { type: "number", example: 100000 } },
            { name: "monthly_amount", in: "query", schema: { type: "number", example: 5000 } },
          ],
          responses: { 200: { description: "All banks 12-month trend graphs" } },
        },
      },
      "/market/banks": {
        get: {
          tags: ["Market"],
          summary: "List market banks with IDs (for FD/RD lookup by bank)",
          responses: { 200: { description: "Bank list with id, bankCode, bankName" } },
        },
      },
      "/market/banks/{id}": {
        get: {
          tags: ["Market"],
          summary: "Single bank detail by market ID",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Bank detail" }, 404: { description: "Not found" } },
        },
      },
      "/market/banks/{id}/rates": {
        get: {
          tags: ["Market"],
          summary: "FD and RD rates for a specific bank by market ID",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } },
            {
              name: "category",
              in: "query",
              schema: { type: "string", enum: ["regular", "senior-citizen"] },
            },
          ],
          responses: { 200: { description: "Bank FD/RD rates" } },
        },
      },
      "/market/banks/{id}/history": {
        get: {
          tags: ["Market"],
          summary: "Graph-ready FD/RD rate + investment history for a bank",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } },
            {
              name: "period",
              in: "query",
              schema: {
                type: "string",
                enum: ["previous_month", "1_year", "3_years", "5_years", "10_years"],
              },
              description: "Omit to return all period graphs",
            },
            { name: "tenure", in: "query", schema: { type: "string", example: "1_year" } },
            {
              name: "category",
              in: "query",
              schema: { type: "string", enum: ["regular", "senior-citizen"] },
            },
            { name: "type", in: "query", schema: { type: "string", enum: ["FD", "RD"] } },
            { name: "principal", in: "query", schema: { type: "number", example: 100000 } },
            { name: "monthly_amount", in: "query", schema: { type: "number", example: 5000 } },
          ],
          responses: { 200: { description: "Chart labels, series, points for frontend graph" } },
        },
      },
      "/market/rates": {
        get: {
          tags: ["Market"],
          summary: "Current FD/RD rates (SBI/HDFC/ICICI/Axis/Others APIs)",
          responses: { 200: { description: "Rate cards" } },
        },
      },
      "/market/history": {
        get: {
          tags: ["Market"],
          summary: "Rate history for graphs",
          parameters: [
            {
              name: "period",
              in: "query",
              schema: {
                type: "string",
                enum: ["previous_month", "1_year", "3_years", "5_years", "10_years"],
              },
            },
          ],
          responses: { 200: { description: "Graph points" } },
        },
      },
      "/market/repo-history": {
        get: {
          tags: ["Market"],
          summary: "RBI repo rate timeline",
          responses: { 200: { description: "Repo history" } },
        },
      },
      "/market/rd": {
        get: {
          tags: ["RD"],
          summary: "List RD portfolio",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "RD list" } },
        },
        post: {
          tags: ["RD"],
          summary: "Invest RD from wallet",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/RdInvestBody" } },
            },
          },
          responses: { 201: { description: "RD invested" } },
        },
      },
      "/market/rd/summary": {
        get: {
          tags: ["RD"],
          summary: "RD portfolio summary",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Summary" } },
        },
      },
      "/market/rd/{id}/break": {
        post: {
          tags: ["RD"],
          summary: "Break RD — credit wallet (invested+interest or invested-loss)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/BreakBody" } },
            },
          },
          responses: { 200: { description: "Settled to wallet" } },
        },
      },
      "/fd": {
        get: {
          tags: ["FD"],
          summary: "List FD portfolio",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "FD list" } },
        },
        post: {
          tags: ["FD"],
          summary: "Invest FD from wallet (+ 2–3% admin fee)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/FdInvestBody" } },
            },
          },
          responses: { 201: { description: "FD invested" } },
        },
      },
      "/fd/summary": {
        get: {
          tags: ["FD"],
          summary: "FD portfolio summary",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Summary" } },
        },
      },
      "/fd/{id}/break": {
        post: {
          tags: ["FD"],
          summary: "Break FD — credit wallet",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/BreakBody" } },
            },
          },
          responses: { 200: { description: "Settled to wallet" } },
        },
      },
      "/wallet": {
        get: {
          tags: ["Wallet"],
          summary: "Get wallet balance",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Balance + recent txs" } },
        },
      },
      "/wallet/transactions": {
        get: {
          tags: ["Wallet"],
          summary: "Wallet transaction history",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Transactions" } },
        },
      },
      "/wallet/deposit/create": {
        post: {
          tags: ["Wallet"],
          summary: "Create Razorpay deposit order",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/DepositCreateBody" } },
            },
          },
          responses: { 201: { description: "Order created" } },
        },
      },
      "/wallet/deposit/verify": {
        post: {
          tags: ["Wallet"],
          summary: "Verify Razorpay payment & credit wallet",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/DepositVerifyBody" } },
            },
          },
          responses: { 200: { description: "Wallet credited" } },
        },
      },
      "/wallet/bank-account": {
        get: {
          tags: ["Wallet"],
          summary: "Get bank account",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Bank account" } },
        },
        put: {
          tags: ["Wallet"],
          summary: "Save bank account",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/BankAccountBody" } },
            },
          },
          responses: { 200: { description: "Saved" } },
        },
      },
      "/wallet/withdraw": {
        post: {
          tags: ["Wallet"],
          summary: "Request withdrawal to bank (admin processes)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/WithdrawBody" } },
            },
          },
          responses: { 201: { description: "Pending admin" } },
        },
      },
      "/wallet/tax-report": {
        get: {
          tags: ["Wallet"],
          summary: "Income-tax investment report for ITR",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "financial_year",
              in: "query",
              schema: { type: "string", example: "2026-2027" },
            },
          ],
          responses: { 200: { description: "Tax report" } },
        },
      },
      "/admin/login": {
        post: {
          tags: ["Admin"],
          summary: "Admin login",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    email: { type: "string", example: "admin@moneytrend.in" },
                    password: { type: "string", example: "Admin@123" },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "Admin tokens" } },
        },
      },
      "/admin/dashboard": {
        get: {
          tags: ["Admin"],
          summary: "Admin dashboard — KPIs, charts, transactions, KYC summary",
          description:
            "Returns summary cards, activity metrics, investment/asset/revenue charts, market indices, recent transactions, KYC doughnut data, and system status.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "from", in: "query", schema: { type: "string", example: "2024-07-18" } },
            { name: "to", in: "query", schema: { type: "string", example: "2024-07-24" } },
            { name: "transactions_limit", in: "query", schema: { type: "integer", example: 8 } },
            { name: "top_limit", in: "query", schema: { type: "integer", example: 5 } },
          ],
          responses: { 200: { description: "Dashboard payload for admin UI" } },
        },
      },
      "/admin/exports/types": {
        get: {
          tags: ["Admin"],
          summary: "List all admin export/download types (CSV & Excel)",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Export types grouped by Users, Investments, Transactions, Market" } },
        },
      },
      "/admin/exports/{type}": {
        get: {
          tags: ["Admin"],
          summary: "Download admin report as CSV or Excel",
          description:
            "Types: dashboard, users, kyc-verification, user-activity, user-documents, roles-permissions, stocks, mutual-funds, fixed-deposits, recurring-deposits, sip-investments, portfolio, deposits, withdrawals, orders, transaction-history, market-overview, indices, commodities",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "type",
              in: "path",
              required: true,
              schema: {
                type: "string",
                example: "users",
                enum: [
                  "dashboard",
                  "users",
                  "kyc-verification",
                  "user-activity",
                  "user-documents",
                  "roles-permissions",
                  "stocks",
                  "mutual-funds",
                  "fixed-deposits",
                  "recurring-deposits",
                  "sip-investments",
                  "portfolio",
                  "deposits",
                  "withdrawals",
                  "orders",
                  "transaction-history",
                  "market-overview",
                  "indices",
                  "commodities",
                ],
              },
            },
            {
              name: "format",
              in: "query",
              schema: { type: "string", enum: ["csv", "xlsx"], default: "csv" },
            },
            { name: "limit", in: "query", schema: { type: "integer", example: 5000 } },
            { name: "kyc_status", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "from", in: "query", schema: { type: "string", example: "2024-07-18" } },
            { name: "to", in: "query", schema: { type: "string", example: "2024-07-24" } },
          ],
          responses: {
            200: { description: "File download (CSV or XLSX)" },
            400: { description: "Invalid type or format" },
          },
        },
      },
      "/admin/investments/asset-allocation/fd": {
        get: {
          tags: ["Admin"],
          summary: "FD asset allocation pie chart (by bank)",
          description: "Graph-ready pie data for Fixed Deposits split by bank.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "user_id", in: "query", schema: { type: "integer" }, description: "Optional — filter for one user" },
            { name: "status", in: "query", schema: { type: "string", enum: ["active", "matured", "closed", "all"], default: "active" } },
          ],
          responses: { 200: { description: "Pie chart payload for FD" } },
        },
      },
      "/admin/investments/asset-allocation/rd": {
        get: {
          tags: ["Admin"],
          summary: "RD asset allocation pie chart (by bank)",
          description: "Graph-ready pie data for Recurring Deposits split by bank.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "user_id", in: "query", schema: { type: "integer" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["active", "matured", "closed", "all"], default: "active" } },
          ],
          responses: { 200: { description: "Pie chart payload for RD" } },
        },
      },
      "/admin/investments/asset-allocation": {
        get: {
          tags: ["Admin"],
          summary: "Full asset allocation — FD pie + RD pie + combined",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "user_id", in: "query", schema: { type: "integer" } },
            { name: "status", in: "query", schema: { type: "string", default: "active" } },
          ],
          responses: { 200: { description: "FD, RD and combined pie charts" } },
        },
      },
      "/admin/investments/fund-performance": {
        get: {
          tags: ["Admin"],
          summary: "Fund Performance — compare banks on one graph (FD/RD)",
          description:
            "Returns multi-bank rate & returns comparison charts, ranking table, and platform investment stats by bank.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "type", in: "query", schema: { type: "string", enum: ["FD", "RD"], default: "FD" } },
            { name: "period", in: "query", schema: { type: "string", enum: ["previous_month", "1_year", "3_years", "5_years", "10_years"], default: "1_year" } },
            { name: "tenure", in: "query", schema: { type: "string", example: "1_year" } },
            { name: "bank_ids", in: "query", schema: { type: "string", example: "1,2,3" }, description: "Comma-separated bank IDs; omit for all banks" },
            { name: "principal", in: "query", schema: { type: "number", example: 100000 } },
            { name: "monthly_amount", in: "query", schema: { type: "number", example: 5000 } },
            { name: "category", in: "query", schema: { type: "string", enum: ["regular", "senior-citizen"], default: "regular" } },
          ],
          responses: { 200: { description: "Graph-ready bank comparison + platform stats" } },
        },
      },
      "/admin/investments/fund-performance/banks/{bankId}": {
        get: {
          tags: ["Admin"],
          summary: "Fund Performance for a single bank by ID",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "bankId", in: "path", required: true, schema: { type: "integer" } },
            { name: "type", in: "query", schema: { type: "string", enum: ["FD", "RD"], default: "FD" } },
            { name: "period", in: "query", schema: { type: "string", default: "1_year" } },
            { name: "principal", in: "query", schema: { type: "number", example: 100000 } },
          ],
          responses: { 200: { description: "Single bank performance chart" }, 404: { description: "Bank not found" } },
        },
      },
      "/admin/investments/fixed-deposits": {
        get: {
          tags: ["Admin"],
          summary: "List all user fixed deposits (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "user_id", in: "query", schema: { type: "integer" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["active", "matured", "closed"] } },
            { name: "bank", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", example: 50 } },
            { name: "offset", in: "query", schema: { type: "integer", example: 0 } },
          ],
          responses: {
            200: {
              description:
                "FD list with investments_table (user, bank, amount, current value, growth_loss_percent), user_bank_table (grouped by user+bank), summary totals, and performance per item",
            },
          },
        },
      },
      "/admin/investments/fixed-deposits/{id}": {
        get: {
          tags: ["Admin"],
          summary: "Get fixed deposit by ID (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "FD detail" }, 404: { description: "Not found" } },
        },
      },
      "/admin/investments/recurring-deposits": {
        get: {
          tags: ["Admin"],
          summary: "List all user recurring deposits (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "user_id", in: "query", schema: { type: "integer" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["active", "matured", "closed"] } },
            { name: "limit", in: "query", schema: { type: "integer" } },
          ],
          responses: {
            200: {
              description:
                "RD list with investments_table (user, bank, monthly amount, total invested, current value, growth_loss_percent), user_bank_table, summary totals, and performance per item",
            },
          },
        },
      },
      "/admin/investments/recurring-deposits/{id}": {
        get: {
          tags: ["Admin"],
          summary: "Get recurring deposit by ID (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "RD detail" }, 404: { description: "Not found" } },
        },
      },
      "/admin/investments/portfolio": {
        get: {
          tags: ["Admin"],
          summary: "List all user portfolios with summary stats",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
          ],
          responses: { 200: { description: "Portfolio summaries per user" } },
        },
      },
      "/admin/investments/portfolio/users/{userId}": {
        get: {
          tags: ["Admin"],
          summary: "Get full user portfolio by user ID",
          description: "Includes FDs, RDs, wallet, deposit/withdrawal/order/transaction counts",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "userId", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Full portfolio detail" }, 404: { description: "Not found" } },
        },
      },
      "/admin/investments/deposits": {
        get: {
          tags: ["Admin"],
          summary: "List wallet deposits (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "user_id", in: "query", schema: { type: "integer" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["created", "paid", "failed"] } },
          ],
          responses: { 200: { description: "Deposits list with totals" } },
        },
      },
      "/admin/investments/deposits/users/{userId}": {
        get: {
          tags: ["Admin"],
          summary: "User deposit summary — total count and amount",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "userId", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Deposit count and history for user" } },
        },
      },
      "/admin/investments/deposits/{id}": {
        get: {
          tags: ["Admin"],
          summary: "Get deposit by ID",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Deposit detail" } },
        },
      },
      "/admin/investments/withdrawals/{id}": {
        get: {
          tags: ["Admin"],
          summary: "Get withdrawal by ID",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Withdrawal detail with bank info" } },
        },
      },
      "/admin/investments/orders": {
        get: {
          tags: ["Admin"],
          summary: "List FD/RD investment orders",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "user_id", in: "query", schema: { type: "integer" } },
            { name: "category", in: "query", schema: { type: "string", enum: ["fd_invest", "rd_invest"] } },
          ],
          responses: { 200: { description: "Orders list" } },
        },
      },
      "/admin/investments/orders/{id}": {
        get: {
          tags: ["Admin"],
          summary: "Get order by ID",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Order detail" } },
        },
      },
      "/admin/investments/transactions": {
        get: {
          tags: ["Admin"],
          summary: "Transaction history (all wallet transactions)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "user_id", in: "query", schema: { type: "integer" } },
            { name: "category", in: "query", schema: { type: "string" } },
            { name: "direction", in: "query", schema: { type: "string", enum: ["credit", "debit"] } },
          ],
          responses: { 200: { description: "Transaction history" } },
        },
      },
      "/admin/investments/transactions/{id}": {
        get: {
          tags: ["Admin"],
          summary: "Get transaction by ID",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Transaction detail" } },
        },
      },
      "/admin/users": {
        get: {
          tags: ["Admin"],
          summary: "List registered users + KYC + nominee",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "kyc_status",
              in: "query",
              schema: {
                type: "string",
                enum: ["pending", "submitted", "verified", "rejected"],
              },
            },
          ],
          responses: { 200: { description: "Users list" } },
        },
      },
      "/admin/users/{id}": {
        get: {
          tags: ["Admin"],
          summary: "Get user by id",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "User details" } },
        },
      },
      "/admin/users/{id}/kyc-status": {
        patch: {
          tags: ["Admin"],
          summary: "Approve or reject user KYC",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/KycStatusBody" } },
            },
          },
          responses: { 200: { description: "Updated" } },
        },
      },
      "/admin/users/{id}/bank-account": {
        get: {
          tags: ["Admin"],
          summary: "View full user bank details (A/C, IFSC, branch, holder)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Bank details" } },
        },
      },
      "/admin/withdrawals": {
        get: {
          tags: ["Admin"],
          summary: "List withdrawal requests",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "status",
              in: "query",
              schema: { type: "string", enum: ["pending", "approved", "rejected", "paid"] },
            },
          ],
          responses: { 200: { description: "Withdrawals" } },
        },
      },
      "/admin/withdrawals/{id}": {
        patch: {
          tags: ["Admin"],
          summary: "Process withdrawal (approve / paid / reject)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WithdrawalProcessBody" },
              },
            },
          },
          responses: { 200: { description: "Processed" } },
        },
      },
      "/admin/commissions": {
        get: {
          tags: ["Admin"],
          summary: "Admin commission ledger (2–3% of investments)",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Commissions" } },
        },
      },
      "/admin/rates": {
        get: {
          tags: ["Admin"],
          summary: "List FD/RD rates (admin)",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Rates list" } },
        },
        post: {
          tags: ["Admin"],
          summary: "Create FD/RD rate",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/FdRdRateBody" } },
            },
          },
          responses: { 201: { description: "Created" } },
        },
      },
      "/admin/rates/sync": {
        post: {
          tags: ["Admin"],
          summary: "Sync rates from bank provider APIs",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Synced" } },
        },
      },
      "/admin/rates/{id}": {
        put: {
          tags: ["Admin"],
          summary: "Update FD/RD rate",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/FdRdRateBody" } },
            },
          },
          responses: { 200: { description: "Updated" } },
        },
        delete: {
          tags: ["Admin"],
          summary: "Deactivate FD/RD rate",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Deactivated" } },
        },
      },
      "/admin/rates/{id}/status": {
        patch: {
          tags: ["Admin"],
          summary: "Activate/deactivate rate",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/RateStatusBody" } },
            },
          },
          responses: { 200: { description: "Status updated" } },
        },
      },
      "/admin/blogs": {
        get: {
          tags: ["Admin"],
          summary: "List all blogs (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "status", in: "query", schema: { type: "string", enum: ["draft", "published"] } },
          ],
          responses: { 200: { description: "Blog list including drafts" } },
        },
        post: {
          tags: ["Admin"],
          summary: "Create blog (admin)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["heading", "description"],
                  properties: {
                    heading: { type: "string" },
                    description: { type: "string" },
                    status: { type: "string", enum: ["draft", "published"] },
                    image: { type: "string", format: "binary" },
                  },
                },
              },
              "application/json": { schema: { $ref: "#/components/schemas/ArticleBody" } },
            },
          },
          responses: { 201: { description: "Blog created" } },
        },
      },
      "/admin/blogs/{id}": {
        get: {
          tags: ["Admin"],
          summary: "Get blog by ID (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Blog detail" }, 404: { description: "Not found" } },
        },
        put: {
          tags: ["Admin"],
          summary: "Update blog (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    heading: { type: "string" },
                    description: { type: "string" },
                    status: { type: "string", enum: ["draft", "published"] },
                    image: { type: "string", format: "binary" },
                  },
                },
              },
              "application/json": { schema: { $ref: "#/components/schemas/ArticleBody" } },
            },
          },
          responses: { 200: { description: "Blog updated" } },
        },
        delete: {
          tags: ["Admin"],
          summary: "Delete blog (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Blog deleted" } },
        },
      },
      "/admin/news": {
        get: {
          tags: ["Admin"],
          summary: "List all news (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "status", in: "query", schema: { type: "string", enum: ["draft", "published"] } },
          ],
          responses: { 200: { description: "News list including drafts" } },
        },
        post: {
          tags: ["Admin"],
          summary: "Create news (admin)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["heading", "description"],
                  properties: {
                    heading: { type: "string" },
                    description: { type: "string" },
                    status: { type: "string", enum: ["draft", "published"] },
                    image: { type: "string", format: "binary" },
                  },
                },
              },
              "application/json": { schema: { $ref: "#/components/schemas/ArticleBody" } },
            },
          },
          responses: { 201: { description: "News created" } },
        },
      },
      "/admin/news/{id}": {
        get: {
          tags: ["Admin"],
          summary: "Get news by ID (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "News detail" }, 404: { description: "Not found" } },
        },
        put: {
          tags: ["Admin"],
          summary: "Update news (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    heading: { type: "string" },
                    description: { type: "string" },
                    status: { type: "string", enum: ["draft", "published"] },
                    image: { type: "string", format: "binary" },
                  },
                },
              },
              "application/json": { schema: { $ref: "#/components/schemas/ArticleBody" } },
            },
          },
          responses: { 200: { description: "News updated" } },
        },
        delete: {
          tags: ["Admin"],
          summary: "Delete news (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "News deleted" } },
        },
      },
      "/admin/banners": {
        get: {
          tags: ["Admin"],
          summary: "List all banners (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", example: 50 } },
            { name: "offset", in: "query", schema: { type: "integer", example: 0 } },
          ],
          responses: { 200: { description: "Banner list" } },
        },
        post: {
          tags: ["Admin"],
          summary: "Create banner (admin)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["title", "description", "image"],
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    image: { type: "string", format: "binary" },
                  },
                },
              },
              "application/json": { schema: { $ref: "#/components/schemas/BannerBody" } },
            },
          },
          responses: { 201: { description: "Banner created" } },
        },
      },
      "/admin/banners/{id}": {
        get: {
          tags: ["Admin"],
          summary: "Get banner by ID (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Banner detail" }, 404: { description: "Not found" } },
        },
        put: {
          tags: ["Admin"],
          summary: "Update banner (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    image: { type: "string", format: "binary" },
                  },
                },
              },
              "application/json": { schema: { $ref: "#/components/schemas/BannerBody" } },
            },
          },
          responses: { 200: { description: "Banner updated" } },
        },
        delete: {
          tags: ["Admin"],
          summary: "Delete banner (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Banner deleted" } },
        },
      },
      "/rates/ticker": {
        get: {
          tags: ["Rates"],
          summary: "Highest FD/RD rates for live frontend ticker (public)",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", example: 10 } },
            { name: "type", in: "query", schema: { type: "string", enum: ["FD", "RD"] } },
            {
              name: "category",
              in: "query",
              schema: { type: "string", enum: ["regular", "senior-citizen"] },
            },
            { name: "tenure", in: "query", schema: { type: "string", example: "5 years" } },
          ],
          responses: { 200: { description: "Ticker data" } },
        },
      },
      "/rates": {
        get: {
          tags: ["Rates"],
          summary: "List FD/RD rates (public)",
          parameters: [
            { name: "type", in: "query", schema: { type: "string", enum: ["FD", "RD"] } },
            { name: "status", in: "query", schema: { type: "string", enum: ["active", "inactive"] } },
            { name: "bank", in: "query", schema: { type: "string" } },
          ],
          responses: { 200: { description: "Rates" } },
        },
      },
      "/rates/{id}": {
        get: {
          tags: ["Rates"],
          summary: "Single FD/RD rate (public)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Rate detail" } },
        },
      },
      "/credit-check/send-otp": {
        post: {
          tags: ["Credit Check"],
          summary: "Send OTP before CIBIL pull (CURRENTLY DISABLED)",
          description: "OTP flow is commented out — not required right now.",
          security: [{ bearerAuth: [] }],
          responses: { 503: { description: "OTP disabled" } },
        },
      },
      "/credit-check/resend-otp": {
        post: {
          tags: ["Credit Check"],
          summary: "Resend credit-check OTP (CURRENTLY DISABLED)",
          security: [{ bearerAuth: [] }],
          responses: { 503: { description: "OTP disabled" } },
        },
      },
      "/credit-check": {
        get: {
          tags: ["Credit Check"],
          summary: "Credit-check history (no login — pass ?mobile=)",
          description: "No JWT required. Use ?mobile=9876543210 or optional Bearer token.",
          parameters: [
            { name: "mobile", in: "query", schema: { type: "string", example: "9876543210" } },
          ],
          responses: { 200: { description: "History list with CIBIL/bureau scores" } },
        },
        post: {
          tags: ["Credit Check"],
          summary: "Run & save CIBIL score — login NOT required",
          description:
            "Public endpoint. Send applicant details + consent. Score is stored and visible to admin.",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["pan", "fullName", "mobile", "dateOfBirth", "consent_version"],
                  properties: {
                    pan: { type: "string", example: "ABCDE1234F" },
                    fullName: { type: "string", example: "John Doe" },
                    mobile: { type: "string", example: "9876543210" },
                    dateOfBirth: { type: "string", example: "1995-01-15" },
                    consent: { type: "boolean", example: true },
                    consent_given: { type: "boolean", example: true },
                    consent_version: { type: "string", example: "v1.0-2026-09-01" },
                    bureau: {
                      type: "string",
                      enum: ["CIBIL", "EXPERIAN", "EQUIFAX", "CRIF"],
                      example: "CIBIL",
                    },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: "Score fetched and saved" },
            400: { description: "Validation / consent missing" },
            429: { description: "Rate limited (24h per bureau)" },
          },
        },
      },
      "/credit-check/latest": {
        get: {
          tags: ["Credit Check"],
          summary: "Latest CIBIL score card — login NOT required",
          description: "Pass ?mobile=10digit or optional Bearer token.",
          parameters: [
            { name: "mobile", in: "query", schema: { type: "string", example: "9876543210" } },
          ],
          responses: { 200: { description: "primary_score, cibil_score, scores_by_bureau" } },
        },
      },
      "/credit-check/run": {
        post: {
          tags: ["Credit Check"],
          summary: "Run credit bureau check for a user (requires verified KYC + consent)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreditCheckRunBody" },
              },
            },
          },
          responses: {
            201: { description: "Credit check completed" },
            403: { description: "KYC not verified" },
            429: { description: "Rate limited (24h per bureau)" },
          },
        },
      },
      "/credit-check/history/{userId}": {
        get: {
          tags: ["Credit Check"],
          summary: "Credit check history for a user",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "userId", in: "path", required: true, schema: { type: "integer" } },
          ],
          responses: { 200: { description: "History list" } },
        },
      },
      "/credit-check/{id}": {
        get: {
          tags: ["Credit Check"],
          summary: "Single credit check detail (owner or admin only)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } },
          ],
          responses: { 200: { description: "Check detail" }, 403: { description: "Access denied" } },
        },
      },
      "/credit-check/run-all/{userId}": {
        post: {
          tags: ["Credit Check"],
          summary: "Run all bureaus for a user (admin only)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "userId", in: "path", required: true, schema: { type: "integer" } },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreditCheckConsentBody" },
              },
            },
          },
          responses: { 201: { description: "Multi-bureau results" } },
        },
      },
      "/admin/credit-checks": {
        get: {
          tags: ["Admin"],
          summary: "List credit checks (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "bureau", in: "query", schema: { type: "string", enum: ["CIBIL", "EXPERIAN", "EQUIFAX", "CRIF"] } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "user_id", in: "query", schema: { type: "integer" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
          ],
          responses: { 200: { description: "Admin credit-check list" } },
        },
      },
      "/admin/credit-checks/{id}": {
        get: {
          tags: ["Admin"],
          summary: "Get credit check by ID (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Credit check detail" }, 404: { description: "Not found" } },
        },
      },
      "/support/help": {
        get: {
          tags: ["Support"],
          summary: "Help center meta — FAQs, subjects, stats",
          responses: { 200: { description: "FAQs + subject dropdown options" } },
        },
      },
      "/support": {
        get: {
          tags: ["Support"],
          summary: "List my support tickets",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "status",
              in: "query",
              schema: { type: "string", enum: ["pending", "in_process", "fixed"] },
            },
          ],
          responses: { 200: { description: "User ticket list" } },
        },
        post: {
          tags: ["Support"],
          summary: "Submit support ticket (emails info@moneytrend.in)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["subject", "description"],
                  properties: {
                    subject: { type: "string", example: "Technical Issue" },
                    description: { type: "string", example: "Describe your issue..." },
                    attachment: { type: "string", format: "binary" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "Ticket created + emailed to support inbox" } },
        },
      },
      "/support/{id}": {
        get: {
          tags: ["Support"],
          summary: "Get my support ticket by ID",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Ticket detail" }, 404: { description: "Not found" } },
        },
      },
      "/admin/support": {
        get: {
          tags: ["Admin"],
          summary: "List all support tickets",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "status",
              in: "query",
              schema: { type: "string", enum: ["pending", "in_process", "fixed"] },
            },
            { name: "search", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
          ],
          responses: { 200: { description: "Tickets + status summary" } },
        },
      },
      "/admin/support/{id}": {
        get: {
          tags: ["Admin"],
          summary: "Get support ticket by ID",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Ticket detail" }, 404: { description: "Not found" } },
        },
      },
      "/admin/support/{id}/status": {
        patch: {
          tags: ["Admin"],
          summary: "Update ticket status (pending | in_process | fixed)",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/SupportTicketStatusBody" } },
            },
          },
          responses: { 200: { description: "Status updated; user notified by email when SMTP is set" } },
        },
      },
    },
  },
  apis: [],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = { swaggerSpec };
