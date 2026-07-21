-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "address" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WalkIn',
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "needsDetails" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "walletBalance" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Cat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "breed" TEXT,
    "gender" TEXT,
    "dateOfBirth" DATETIME,
    "lifeStage" TEXT,
    "coatType" TEXT,
    "foundingNumber" INTEGER,
    "careNotes" TEXT,
    "healthNotes" TEXT,
    "vaccinationExpiry" DATETIME,
    "groomingInterval" INTEGER,
    "photos" TEXT,
    "customerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Cat_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatAssessment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catId" TEXT NOT NULL,
    "skinCondition" TEXT,
    "coatCondition" TEXT,
    "earCondition" TEXT,
    "nailCondition" TEXT,
    "stressLevel" TEXT,
    "weightKg" REAL,
    "findings" TEXT,
    "carePlan" TEXT,
    "rebookDays" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CatAssessment_catId_fkey" FOREIGN KEY ("catId") REFERENCES "Cat" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MembershipTier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "monthlyPrice" REAL NOT NULL,
    "annualPrice" REAL,
    "groomingCredits" INTEGER NOT NULL DEFAULT 0,
    "boardingDiscount" REAL NOT NULL DEFAULT 0,
    "qualification" TEXT NOT NULL DEFAULT 'Manual',
    "annualSpendThreshold" REAL,
    "pointsMultiplier" REAL NOT NULL DEFAULT 1,
    "cardType" TEXT NOT NULL DEFAULT 'Digital',
    "benefits" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "memberNumber" INTEGER,
    "startDate" DATETIME NOT NULL,
    "expiryDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Membership_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Membership_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "MembershipTier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoyaltyEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoyaltyEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "price" REAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CareTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "catId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "staffId" TEXT,
    "doneAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CareTask_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CareTask_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CashUp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "expectedRM" REAL NOT NULL,
    "countedRM" REAL NOT NULL,
    "variance" REAL NOT NULL,
    "note" TEXT,
    "staffName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "category" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "notes" TEXT,
    "vendor" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "dueDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StatementCell" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "rowKey" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StatementRowDef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PlanDriver" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BalanceSheetCell" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "asOf" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StatementRowOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "orderJson" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StatementHiddenRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "rowKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WalletEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Standard',
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Available',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "catId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "serviceId" TEXT,
    "staffId" TEXT,
    "scheduledAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'Scheduled',
    "roomId" TEXT,
    "price" REAL,
    "depositRM" REAL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "staffNotes" TEXT,
    "usedCredit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Appointment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_catId_fkey" FOREIGN KEY ("catId") REFERENCES "Cat" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Appointment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Appointment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT,
    "date" DATETIME NOT NULL,
    "total" REAL NOT NULL,
    "category" TEXT NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransactionLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "catId" TEXT,
    "productId" TEXT,
    "appointmentId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" REAL NOT NULL,
    "subtotal" REAL NOT NULL,
    CONSTRAINT "TransactionLine_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransactionLine_catId_fkey" FOREIGN KEY ("catId") REFERENCES "Cat" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TransactionLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TransactionLine_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "costPrice" REAL NOT NULL DEFAULT 0,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "sku" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT,
    "senderPhone" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WhatsAppLead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "customerId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "summary" TEXT NOT NULL,
    "proposedAction" TEXT,
    "confidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WhatsAppLead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WhatsAppMessage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WhatsAppLead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "customerId" TEXT,
    "catId" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ActionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actionKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "customerId" TEXT,
    "catId" TEXT,
    "status" TEXT NOT NULL,
    "snoozeUntil" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BusinessPlan" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "startMonth" TEXT NOT NULL,
    "breakevenMonth" TEXT NOT NULL,
    "avgSaleValue" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'RM',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MonthlyTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "month" TEXT NOT NULL,
    "revenueTarget" REAL NOT NULL DEFAULT 0,
    "costBudget" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AcademyEnrollment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "course" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "enrolledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Cat_foundingNumber_key" ON "Cat"("foundingNumber");

-- CreateIndex
CREATE INDEX "CatAssessment_catId_idx" ON "CatAssessment"("catId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipTier_name_key" ON "MembershipTier"("name");

-- CreateIndex
CREATE INDEX "Membership_customerId_idx" ON "Membership"("customerId");

-- CreateIndex
CREATE INDEX "Membership_status_idx" ON "Membership"("status");

-- CreateIndex
CREATE INDEX "LoyaltyEntry_customerId_idx" ON "LoyaltyEntry"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_pinHash_key" ON "Staff"("pinHash");

-- CreateIndex
CREATE UNIQUE INDEX "Service_name_key" ON "Service"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CareTask_date_appointmentId_task_key" ON "CareTask"("date", "appointmentId", "task");

-- CreateIndex
CREATE UNIQUE INDEX "CashUp_date_key" ON "CashUp"("date");

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "Expense_paid_idx" ON "Expense"("paid");

-- CreateIndex
CREATE UNIQUE INDEX "StatementCell_year_month_rowKey_key" ON "StatementCell"("year", "month", "rowKey");

-- CreateIndex
CREATE UNIQUE INDEX "PlanDriver_key_key" ON "PlanDriver"("key");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceSheetCell_asOf_lineKey_key" ON "BalanceSheetCell"("asOf", "lineKey");

-- CreateIndex
CREATE UNIQUE INDEX "StatementRowOrder_year_section_key" ON "StatementRowOrder"("year", "section");

-- CreateIndex
CREATE UNIQUE INDEX "StatementHiddenRow_year_rowKey_key" ON "StatementHiddenRow"("year", "rowKey");

-- CreateIndex
CREATE INDEX "WalletEntry_customerId_idx" ON "WalletEntry"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_name_key" ON "Room"("name");

-- CreateIndex
CREATE INDEX "Appointment_customerId_idx" ON "Appointment"("customerId");

-- CreateIndex
CREATE INDEX "Appointment_catId_idx" ON "Appointment"("catId");

-- CreateIndex
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");

-- CreateIndex
CREATE INDEX "Appointment_scheduledAt_idx" ON "Appointment"("scheduledAt");

-- CreateIndex
CREATE INDEX "Transaction_customerId_idx" ON "Transaction"("customerId");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE INDEX "Transaction_reference_idx" ON "Transaction"("reference");

-- CreateIndex
CREATE INDEX "TransactionLine_transactionId_idx" ON "TransactionLine"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionLine_appointmentId_idx" ON "TransactionLine"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_name_key" ON "Product"("name");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_externalId_key" ON "WhatsAppMessage"("externalId");

-- CreateIndex
CREATE INDEX "ActionLog_actionKey_idx" ON "ActionLog"("actionKey");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyTarget_month_key" ON "MonthlyTarget"("month");

