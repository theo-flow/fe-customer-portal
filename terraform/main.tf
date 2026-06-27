terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }

  # Migrate to S3 backend once daai-insure-tf-state bucket is confirmed:
  # backend "s3" {
  #   bucket  = "daai-insure-tf-state"
  #   key     = "fe-customer-portal/terraform.tfstate"
  #   region  = "af-south-1"
  #   profile = "Sithembiso"
  # }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}
