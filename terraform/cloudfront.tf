locals {
  lambda_origin_id = "lambda-server"
  s3_origin_id     = "s3-assets"
  # API Gateway HTTP API host (strip https:// and trailing /)
  lambda_host = replace(replace(aws_apigatewayv2_stage.default.invoke_url, "https://", ""), "/", "")
}

resource "aws_cloudfront_distribution" "portal" {
  enabled         = true
  is_ipv6_enabled = true
  price_class     = "PriceClass_100" # US, Europe, and Asia — lowest cost tier

  # Lambda origin for SSR
  origin {
    domain_name = local.lambda_host
    origin_id   = local.lambda_origin_id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # S3 origin for static assets
  origin {
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_id                = local.s3_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
  }

  # Static assets: long cache from S3
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = local.s3_origin_id
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 31536000
    default_ttl = 31536000
    max_ttl     = 31536000
  }

  # Public files (favicon, robots.txt etc): short cache from S3
  ordered_cache_behavior {
    path_pattern           = "/favicon.*"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = local.s3_origin_id
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 3600
    default_ttl = 86400
    max_ttl     = 86400
  }

  # Default: all requests → Lambda (SSR), no caching
  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = local.lambda_origin_id
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "CloudFront-Viewer-Country"]
      cookies { forward = "all" }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
