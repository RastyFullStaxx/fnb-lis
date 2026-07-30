-- CreateTable
CREATE TABLE "DevicePin" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "pinHash" TEXT NOT NULL,
    "recoveryQuestion" TEXT NOT NULL,
    "recoveryAnswerHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DevicePin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
