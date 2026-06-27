variable "aws_region" {
  default = "af-south-1"
}

variable "aws_profile" {
  default = "Sithembiso"
}

variable "app_name" {
  default = "theoflow-portal"
}

variable "stage" {
  default = "production"
}

variable "cognito_user_pool_id" {
  description = "Cognito User Pool ID (af-south-1_RujziOkMM)"
}

variable "cognito_client_id" {
  description = "Cognito App Client ID (4smqcoj7jc58ptq84r8m2q9ku2)"
}

variable "dynamodb_table" {
  default = "daai-insure-orgs"
}

variable "s3_intake_bucket" {
  default = "daai-insure-intake"
}
