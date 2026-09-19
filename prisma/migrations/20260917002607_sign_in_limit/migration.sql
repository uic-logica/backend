-- CreateTable
CREATE TABLE "SignInLimit" (
    "identifier" TEXT NOT NULL,
    "guesses" INTEGER NOT NULL DEFAULT 0,
    "codeRequests" INTEGER NOT NULL DEFAULT 0,
    "windowEndsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignInLimit_pkey" PRIMARY KEY ("identifier")
);
